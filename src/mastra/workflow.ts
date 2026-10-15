import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { withTransaction } from "@/db/pool";
import {
  appendEvent,
  applyReviewOutcome,
  countOpenPurchaseOrders,
  findDuplicateInvoiceIds,
  findPurchaseOrderByNumber,
  getPurchaseOrderById,
  getReconciliationIdByIdempotencyKey,
  getSupplierByCode,
  insertInvoice,
  insertReconciliation,
  markDecisionResumed,
  markFailed,
  storeAutomaticResult,
  type PurchaseOrderRecord,
} from "@/db/repository";
import { getPool } from "@/db/pool";
import { mapLinesBySku, reconcile, type LineMapping, type ReconcileContext } from "@/domain/reconcile";
import { invoicePayloadSchema, type InvoicePayload } from "@/schemas/domain";
import { AgentError, agentMode, runReconciliationAgent, type AgentRunResult } from "./agent";

/**
 * reconciliation-workflow:
 *   validate-input → persist-invoice-and-run → agent-lookup-mapping → deterministic-reconcile
 *   → review-gate (real suspend()) → persist-terminal-state
 *
 * Every step reads/writes Postgres; the suspended snapshot lives in Mastra's Postgres store, so a
 * different process can resume it with only the runId.
 */

export const WORKFLOW_ID = "reconciliationWorkflow";
export const REVIEW_STEP_ID = "review-gate";

const carrier = z.object({
  reconciliationId: z.string(),
  // "FAILED" / "DUPLICATE_REQUEST" mark early exits via bail().
  status: z.string(),
});

const workflowInput = z.object({
  invoice: z.unknown(),
  idempotencyKey: z.string().min(8).max(100),
  requestedBy: z.string().min(1).max(200),
  scenarioId: z.string().max(64).nullable(),
});

const validateInput = createStep({
  id: "validate-input",
  inputSchema: workflowInput,
  outputSchema: z.object({
    invoice: z.custom<InvoicePayload>(),
    supplierId: z.string(),
    idempotencyKey: z.string(),
    requestedBy: z.string(),
    scenarioId: z.string().nullable(),
  }),
  execute: async ({ inputData }) => {
    const invoice = invoicePayloadSchema.parse(inputData.invoice);
    const supplier = await getSupplierByCode(invoice.supplierCode);
    if (!supplier) throw new Error(`unknown supplier ${invoice.supplierCode}`);
    return { ...inputData, invoice, supplierId: supplier.id };
  },
});

const persistInvoiceAndRun = createStep({
  id: "persist-invoice-and-run",
  inputSchema: validateInput.outputSchema,
  outputSchema: z.object({
    reconciliationId: z.string(),
    invoiceId: z.string(),
    supplierId: z.string(),
    invoice: z.custom<InvoicePayload>(),
  }),
  execute: async ({ inputData, runId, bail }) => {
    const created = await withTransaction(async (client) => {
      const invoiceId = await insertInvoice(client, inputData.invoice, inputData.supplierId);
      const reconciliationId = await insertReconciliation(client, {
        invoiceId,
        runId,
        idempotencyKey: inputData.idempotencyKey,
        scenarioId: inputData.scenarioId,
        agentMode: agentMode(),
        requestedBy: inputData.requestedBy,
      });
      if (!reconciliationId) {
        // Same idempotency key raced us: undo the invoice insert, nothing else happens.
        throw new DuplicateRequest();
      }
      await appendEvent(reconciliationId, "CREATED", inputData.requestedBy, { runId, scenarioId: inputData.scenarioId }, client);
      return { reconciliationId, invoiceId };
    }).catch(async (err) => {
      if (err instanceof DuplicateRequest) return null;
      throw err;
    });
    if (!created) {
      const existing = await getReconciliationIdByIdempotencyKey(inputData.idempotencyKey);
      return bail({ reconciliationId: existing ?? "", status: "DUPLICATE_REQUEST" });
    }
    return { ...created, supplierId: inputData.supplierId, invoice: inputData.invoice };
  },
});

class DuplicateRequest extends Error {}

function toDomainPo(po: PurchaseOrderRecord) {
  return { id: po.id, poNumber: po.poNumber, supplierId: po.supplierId, currency: po.currency, status: po.status, lines: po.lines };
}

/** Rejects proposals that reference IDs the deterministic layer cannot verify. */
function applyProposalMappings(base: LineMapping[], proposal: AgentRunResult["proposal"], po: PurchaseOrderRecord, invoice: InvoicePayload): LineMapping[] {
  const invoiceIds = new Set(invoice.lines.map((l) => l.lineId));
  const poIds = new Set(po.lines.map((l) => l.lineId));
  const usedPo = new Set(base.filter((m) => m.poLineId).map((m) => m.poLineId!));
  const byInvoice = new Map(base.map((m) => [m.invoiceLineId, m]));
  for (const m of proposal.lineMappings) {
    if (!invoiceIds.has(m.invoiceLineId)) throw new AgentError("AGENT_INVALID_OUTPUT", `agent referenced unknown invoice line ${m.invoiceLineId}`);
    if (m.poLineId === null) continue;
    if (!poIds.has(m.poLineId)) throw new AgentError("AGENT_INVALID_OUTPUT", `agent referenced unknown PO line ${m.poLineId}`);
    const current = byInvoice.get(m.invoiceLineId);
    if (current?.basis === "SKU") continue; // deterministic SKU matches always win
    if (usedPo.has(m.poLineId)) throw new AgentError("AGENT_INVALID_OUTPUT", `agent mapped PO line ${m.poLineId} twice`);
    usedPo.add(m.poLineId);
    byInvoice.set(m.invoiceLineId, { invoiceLineId: m.invoiceLineId, poLineId: m.poLineId, basis: "SEMANTIC" });
  }
  return invoice.lines.map((l) => byInvoice.get(l.lineId) ?? { invoiceLineId: l.lineId, poLineId: null, basis: null });
}

const agentLookupMapping = createStep({
  id: "agent-lookup-mapping",
  inputSchema: persistInvoiceAndRun.outputSchema,
  outputSchema: z.object({
    reconciliationId: z.string(),
    supplierId: z.string(),
    invoice: z.custom<InvoicePayload>(),
    purchaseOrderId: z.string().nullable(),
    mapping: z.array(z.custom<LineMapping>()),
    context: z.custom<ReconcileContext>(),
    agent: z.unknown(),
  }),
  execute: async ({ inputData, mastra, bail, ...rest }) => {
    const { reconciliationId, invoice, supplierId, invoiceId } = inputData;
    const tracing = (rest as { tracingContext?: unknown }).tracingContext;
    try {
      const duplicateInvoiceIds = await findDuplicateInvoiceIds(supplierId, invoice.invoiceNumber, invoiceId);
      let po: PurchaseOrderRecord | null = null;
      let poSelection: ReconcileContext["poSelection"] = "NONE";
      let candidateCount = 0;
      let agentResult: AgentRunResult | null = null;

      // 1) Deterministic first: an explicit, existing PO reference is used as-is.
      if (invoice.poReference) {
        po = await findPurchaseOrderByNumber(invoice.poReference);
        if (po) {
          poSelection = "REFERENCE";
          candidateCount = 1;
        }
      }
      let mapping: LineMapping[] = po ? mapLinesBySku(invoice.lines, po.lines) : [];

      const lineTask = (lines: InvoicePayload["lines"]) =>
        lines.map((l) => ({ lineId: l.lineId, sku: l.sku ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }));

      if (po) {
        // 2a) PO fixed: ask the agent only about lines SKU matching could not resolve, and only if
        //     there are unused PO lines left and the PO belongs to the invoice's supplier.
        const unresolved = invoice.lines.filter((l) => !mapping.find((m) => m.invoiceLineId === l.lineId && m.poLineId));
        const usedPo = new Set(mapping.map((m) => m.poLineId).filter(Boolean));
        const freePoLines = po.lines.filter((l) => !usedPo.has(l.lineId));
        if (unresolved.length && freePoLines.length && po.supplierId === supplierId) {
          agentResult = await runReconciliationAgent(
            mastra,
            { invoiceNumber: invoice.invoiceNumber, supplierCode: invoice.supplierCode, currency: invoice.currency, poReference: invoice.poReference ?? null, fixedPurchaseOrderId: po.id, lines: lineTask(unresolved) },
            { supplierId, fixedPurchaseOrderId: po.id },
            { reconciliationId, tracingContext: tracing },
          );
          if (agentResult.proposal.purchaseOrderId && agentResult.proposal.purchaseOrderId !== po.id) {
            throw new AgentError("AGENT_INVALID_OUTPUT", "agent returned a different purchase order than the fixed one");
          }
          mapping = applyProposalMappings(mapping, agentResult.proposal, po, invoice);
        }
      } else {
        // 2b) No usable reference: the agent searches this supplier's open orders, if any exist.
        candidateCount = await countOpenPurchaseOrders(supplierId);
        if (candidateCount > 0) {
          agentResult = await runReconciliationAgent(
            mastra,
            { invoiceNumber: invoice.invoiceNumber, supplierCode: invoice.supplierCode, currency: invoice.currency, poReference: invoice.poReference ?? null, fixedPurchaseOrderId: null, lines: lineTask(invoice.lines) },
            { supplierId, fixedPurchaseOrderId: null },
            { reconciliationId, tracingContext: tracing },
          );
          const chosenId = agentResult.proposal.purchaseOrderId;
          if (chosenId) {
            const chosen = await getPurchaseOrderById(chosenId);
            if (!chosen || chosen.supplierId !== supplierId || chosen.status !== "OPEN") {
              throw new AgentError("AGENT_INVALID_OUTPUT", "agent selected a purchase order outside the verified candidate set");
            }
            po = chosen;
            poSelection = "AGENT";
            mapping = applyProposalMappings(mapLinesBySku(invoice.lines, po.lines), agentResult.proposal, po, invoice);
          }
        }
      }

      await appendEvent(reconciliationId, "AGENT_STEP", "system", {
        poSelection,
        candidateCount,
        agentInvoked: Boolean(agentResult),
        agentMode: agentResult?.mode ?? null,
        modelId: agentResult?.modelId ?? null,
        toolCalls: agentResult?.toolCalls ?? [],
        confidence: agentResult?.proposal.confidence ?? null,
      });
      if (agentResult?.traceId) {
        await getPool().query("update app.reconciliations set trace_id = coalesce(trace_id, $2) where id = $1", [reconciliationId, agentResult.traceId]);
      }

      return {
        reconciliationId,
        supplierId,
        invoice,
        purchaseOrderId: po?.id ?? null,
        mapping,
        context: {
          duplicateInvoiceIds,
          poSelection,
          candidateCount,
          agentConfidence: agentResult?.proposal.confidence ?? null,
        },
        agent: agentResult
          ? { mode: agentResult.mode, modelId: agentResult.modelId, toolCalls: agentResult.toolCalls, usage: agentResult.usage, proposal: agentResult.proposal }
          : null,
      };
    } catch (err) {
      const e = err instanceof AgentError ? err : new AgentError("MODEL_UNAVAILABLE", (err as Error).message);
      await markFailed(reconciliationId, e.code, e.message);
      await appendEvent(reconciliationId, "FAILED", "system", { code: e.code, message: e.message.slice(0, 300) });
      return bail({ reconciliationId, status: "FAILED" });
    }
  },
});

const deterministicReconcile = createStep({
  id: "deterministic-reconcile",
  inputSchema: agentLookupMapping.outputSchema,
  outputSchema: carrier,
  execute: async ({ inputData }) => {
    const { reconciliationId, invoice, supplierId, purchaseOrderId, mapping, context, agent } = inputData;
    const po = purchaseOrderId ? await getPurchaseOrderById(purchaseOrderId) : null;
    const result = reconcile(
      { invoiceNumber: invoice.invoiceNumber, supplierId, poReference: invoice.poReference, currency: invoice.currency, lines: invoice.lines, declared: invoice.declared },
      po ? toDomainPo(po) : null,
      mapping,
      context,
    );
    const agentRun = agent as { proposal?: { reasons?: string[] } } | null;
    const stored = await storeAutomaticResult(reconciliationId, {
      status: result.status,
      purchaseOrderId,
      result: {
        ...result,
        poSelection: context.poSelection,
        candidateCount: context.candidateCount,
        // Labeled recommendation only; it never overrides ruleFindings.
        explanation: agentRun?.proposal?.reasons?.join(" · ") ?? null,
      },
      agentOutput: agent ?? null,
      agentInvoked: Boolean(agent),
    });
    if (!stored) throw new Error(`reconciliation ${reconciliationId} was not in PROCESSING state`);
    await appendEvent(reconciliationId, "RECONCILED", "system", {
      status: result.status,
      ruleIds: result.findings.map((f) => f.ruleId),
    });
    return { reconciliationId, status: result.status };
  },
});

export const reviewResumeSchema = z.object({
  decisionId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
  reviewer: z.string().min(1),
});

const reviewGate = createStep({
  id: REVIEW_STEP_ID,
  inputSchema: carrier,
  outputSchema: carrier.extend({ decisionId: z.string().nullable(), decision: z.enum(["APPROVE", "REJECT"]).nullable() }),
  suspendSchema: z.object({ reconciliationId: z.string(), status: z.string() }),
  resumeSchema: reviewResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.status === "MATCHED") return { ...inputData, decisionId: null, decision: null };
    if (!resumeData) {
      await appendEvent(inputData.reconciliationId, "SUSPENDED_FOR_REVIEW", "system", { status: inputData.status });
      return suspend({ reconciliationId: inputData.reconciliationId, status: inputData.status });
    }
    // The decision row is written (and validated) before resume; re-check it here so a resume can
    // never carry a decision that is not persisted.
    const { rows } = await getPool().query(
      "select decision, reviewer from app.review_decisions where id = $1 and reconciliation_id = $2",
      [resumeData.decisionId, inputData.reconciliationId],
    );
    const row = rows[0];
    if (!row || row.decision !== resumeData.decision) throw new Error("resume data does not match the persisted review decision");
    return { ...inputData, decisionId: resumeData.decisionId, decision: resumeData.decision };
  },
});

const persistTerminalState = createStep({
  id: "persist-terminal-state",
  inputSchema: reviewGate.outputSchema,
  outputSchema: carrier,
  execute: async ({ inputData }) => {
    const { reconciliationId, decision } = inputData;
    if (!decision) {
      await appendEvent(reconciliationId, "FINALIZED", "system", { status: inputData.status, automatic: true });
      return { reconciliationId, status: inputData.status };
    }
    const status = decision === "APPROVE" ? "APPROVED_WITH_EXCEPTION" : "REJECTED";
    await withTransaction(async (client) => {
      const changed = await applyReviewOutcome(reconciliationId, status, client);
      await markDecisionResumed(reconciliationId, client);
      if (changed) await appendEvent(reconciliationId, "FINALIZED", "system", { status, automatic: false }, client);
    });
    return { reconciliationId, status };
  },
});

export const reconciliationWorkflow = createWorkflow({
  id: WORKFLOW_ID,
  description: "Validate, persist, agent lookup/mapping, deterministic reconciliation, human review gate, terminal state.",
  inputSchema: workflowInput,
  outputSchema: carrier,
})
  .then(validateInput)
  .then(persistInvoiceAndRun)
  .then(agentLookupMapping)
  .then(deterministicReconcile)
  .then(reviewGate)
  .then(persistTerminalState)
  .commit();
