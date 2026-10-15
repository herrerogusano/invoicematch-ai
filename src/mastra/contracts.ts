import { z } from "zod";

/** Structured output the reconciliation agent must return. Validated with Zod and then against the DB. */
export const agentProposalSchema = z.object({
  purchaseOrderId: z.string().uuid().nullable(),
  lineMappings: z
    .array(
      z.object({
        invoiceLineId: z.string().min(1),
        poLineId: z.string().min(1).nullable(),
      }),
    )
    .max(50),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  reasons: z.array(z.string().max(300)).min(1).max(8),
  evidence: z
    .array(
      z.object({
        invoiceLineId: z.string().min(1).nullable(),
        poLineId: z.string().min(1).nullable(),
        note: z.string().max(300),
      }),
    )
    .max(20),
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;

/** What the workflow hands to the agent. Only data needed for matching; no declared totals. */
export interface AgentTask {
  invoiceNumber: string;
  supplierCode: string;
  currency: string;
  poReference: string | null;
  /** Set when the PO is already fixed by an explicit reference; the agent only maps lines. */
  fixedPurchaseOrderId: string | null;
  lines: Array<{ lineId: string; sku: string | null; description: string; quantity: string; unitPrice: string }>;
}

export const TASK_OPEN = "<task>";
export const TASK_CLOSE = "</task>";

export function renderTaskPrompt(task: AgentTask): string {
  const goal = task.fixedPurchaseOrderId
    ? `The purchase order is fixed (${task.fixedPurchaseOrderId}). Fetch it with getSupplierAndOrderDetails and map each listed invoice line to at most one of its lines.`
    : "Find the purchase order this invoice belongs to with lookupPurchaseOrders, inspect plausible candidates with getSupplierAndOrderDetails, then select one or return null if none or several are equally plausible.";
  return [
    goal,
    "Return ONLY a JSON object matching the required schema, with no prose around it.",
    `${TASK_OPEN}${JSON.stringify(task)}${TASK_CLOSE}`,
  ].join("\n\n");
}

export function parseTaskFromPrompt(text: string): AgentTask | null {
  const start = text.indexOf(TASK_OPEN);
  const end = text.indexOf(TASK_CLOSE);
  if (start < 0 || end < start) return null;
  return JSON.parse(text.slice(start + TASK_OPEN.length, end)) as AgentTask;
}

/** Extracts the first top-level JSON object from model text (tolerates ```json fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model output contains no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}
