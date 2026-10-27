import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { Mastra } from "@mastra/core/mastra";
import { BudgetExceededError, LIMITS, reserveLiveCall, settleLiveCall } from "@/server/budget";
import { agentProposalSchema, extractJsonObject, renderTaskPrompt, type AgentProposal, type AgentTask } from "./contracts";
import { createMockModel, MOCK_MODEL_ID } from "./mock-model";
import { reconciliationTools, TOOL_SCOPE_KEY, type ToolScope } from "./tools";

export const AGENT_ID = "reconciliationAgent";
export const DEFAULT_LIVE_MODEL = "claude-haiku-5-5";
/** Bumped whenever INSTRUCTIONS, the task prompt or the tools change; recorded on benchmark traces. */
export const PROMPT_VERSION = "v3";

export type AgentMode = "mock" | "anthropic";

export function agentMode(): AgentMode {
  const mode = process.env.AGENT_MODE ?? "mock";
  if (mode !== "mock" && mode !== "anthropic") throw new Error(`invalid AGENT_MODE ${mode}`);
  return mode;
}

export function liveModelId(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_LIVE_MODEL;
}

/** Test-only seam to inject faults (outage, rate limit). Ignored outside NODE_ENV=test. */
let testModelOverride: LanguageModelV4 | null = null;
export function setAgentModelForTests(model: LanguageModelV4 | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setAgentModelForTests is test-only");
  testModelOverride = model;
}

function resolveModel(): LanguageModelV4 {
  if (testModelOverride && process.env.NODE_ENV === "test") return testModelOverride;
  if (agentMode() === "mock") return createMockModel();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AgentError("AGENT_NOT_CONFIGURED", "AGENT_MODE=anthropic but ANTHROPIC_API_KEY is not set");
  return createAnthropic({ apiKey })(liveModelId());
}

export const INSTRUCTIONS = `You are the InvoiceMatch reconciliation assistant.
Your only job is to (1) identify which purchase order a synthetic supplier invoice belongs to when its reference is missing or uncertain, and (2) propose which invoice line corresponds to which purchase-order line.

Rules:
- Use the tools. Only use IDs that the tools returned; never invent IDs.
- lookupPurchaseOrders returns candidates with their lines, one page at a time. If no candidate fits and hasMore is true, fetch the next page before deciding. Call getSupplierAndOrderDetails only when you need more than the listed lines.
- Never compute, correct or judge money amounts, totals or taxes. Deterministic code does that.
- If no candidate is plausible, or several are equally plausible, return "purchaseOrderId": null and confidence "LOW". Never force a choice.
- Only OPEN purchase orders can be selected. If the only fitting order is CLOSED, return null and say so in reasons.
- Map each invoice line to at most one PO line, and each PO line to at most one invoice line. Use null when unsure.
- You cannot approve, reject, pay or modify anything.
- Reply with ONLY a JSON object: {"purchaseOrderId": string|null, "lineMappings": [{"invoiceLineId": string, "poLineId": string|null}], "confidence": "HIGH"|"MEDIUM"|"LOW", "reasons": string[], "evidence": [{"invoiceLineId": string|null, "poLineId": string|null, "note": string}]}`;

export function createReconciliationAgent(): Agent {
  return new Agent({
    id: AGENT_ID,
    name: "Reconciliation agent",
    description: "Selects a purchase-order candidate and proposes line correspondences using DB-backed tools.",
    instructions: INSTRUCTIONS,
    model: () => resolveModel(),
    tools: reconciliationTools,
  });
}

export type AgentErrorCode =
  | "AGENT_NOT_CONFIGURED"
  | "BUDGET_EXCEEDED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "AGENT_INVALID_OUTPUT";

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function classify(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  if (err instanceof BudgetExceededError) return new AgentError("BUDGET_EXCEEDED", err.message);
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  if (status === 429) return new AgentError("MODEL_RATE_LIMITED", "model provider rate limit or spend cap reached");
  return new AgentError("MODEL_UNAVAILABLE", `model call failed: ${e?.message ?? String(err)}`.slice(0, 300));
}

export interface AgentRunResult {
  proposal: AgentProposal;
  modelId: string;
  mode: AgentMode | "test";
  toolCalls: string[];
  usage: { inputTokens: number; outputTokens: number; requests: number };
  traceId: string | null;
}

/** Runs the agent once with bounded steps/tokens and returns a Zod-validated proposal. */
export async function runReconciliationAgent(
  mastra: Mastra,
  task: AgentTask,
  scope: ToolScope,
  meta: { reconciliationId: string; tracingContext?: unknown },
): Promise<AgentRunResult> {
  const mode = testModelOverride && process.env.NODE_ENV === "test" ? "test" : agentMode();
  const modelId = mode === "anthropic" ? liveModelId() : MOCK_MODEL_ID;
  // Fail closed before any reservation or network call.
  if (mode === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new AgentError("AGENT_NOT_CONFIGURED", "AGENT_MODE=anthropic but ANTHROPIC_API_KEY is not set");
  }
  const reservation = mode === "anthropic" ? await reserveLiveCall(modelId, meta.reconciliationId).catch((e) => { throw classify(e); }) : null;

  const requestContext = new RequestContext();
  requestContext.set(TOOL_SCOPE_KEY, scope);

  let usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  try {
    const agent = mastra.getAgent(AGENT_ID);
    const res = await agent.generate(renderTaskPrompt(task), {
      requestContext,
      maxSteps: LIMITS.maxSteps,
      modelSettings: { maxOutputTokens: LIMITS.maxOutputTokens, temperature: 0 },
      tracingOptions: { metadata: { reconciliationId: meta.reconciliationId, agentMode: mode } },
      ...(meta.tracingContext ? { tracingContext: meta.tracingContext as never } : {}),
    });
    const total = res.totalUsage ?? res.usage;
    usage = {
      inputTokens: Number(total?.inputTokens ?? 0),
      outputTokens: Number(total?.outputTokens ?? 0),
      requests: res.steps?.length ?? 1,
    };
    if (res.error) throw res.error;
    const toolCalls = (res.steps ?? []).flatMap((s) => (s.toolCalls ?? []).map((c) => (c as { payload?: { toolName?: string }; toolName?: string }).payload?.toolName ?? (c as { toolName?: string }).toolName ?? "unknown"));
    let proposal: AgentProposal;
    try {
      proposal = agentProposalSchema.parse(extractJsonObject(res.text));
    } catch (e) {
      throw new AgentError("AGENT_INVALID_OUTPUT", `agent output failed validation: ${(e as Error).message}`.slice(0, 300));
    }
    if (reservation) await settleLiveCall(reservation, { ok: true, ...usage });
    return { proposal, modelId, mode, toolCalls, usage, traceId: res.traceId ?? null };
  } catch (err) {
    if (reservation) await settleLiveCall(reservation, { ok: false, ...usage }).catch(() => undefined);
    throw classify(err);
  }
}
