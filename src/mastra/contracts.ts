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
    : "Find the purchase order this invoice belongs to with lookupPurchaseOrders (page through the results while hasMore is true and nothing fits yet), compare the candidates' lines with the invoice lines, then select one or return null if none or several are equally plausible.";
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

/**
 * Extracts the first complete top-level JSON object from model text. Tolerates ```json fences and
 * stray characters after the object (seen in the agent benchmark: a correct answer followed by
 * "}]"). The result is still validated with Zod and then against the database.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("model output contains no JSON object");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("model output contains no complete JSON object");
}
