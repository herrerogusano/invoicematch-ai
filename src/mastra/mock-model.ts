import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { dec } from "@/domain/money";
import { parseTaskFromPrompt, type AgentProposal, type AgentTask } from "./contracts";

/**
 * MOCK language model for offline tests and demos. It is NOT an LLM and its output is never
 * presented as model evidence.
 *
 * It plugs into the real Mastra agent loop as a LanguageModelV4, so tool calls go through Mastra's
 * real tool execution against the real database; only the "decisions" are scripted with a small,
 * transparent heuristic (token overlap + equal price/quantity).
 */

export const MOCK_MODEL_ID = "invoicematch-mock-v1";

interface PoDetails {
  id: string;
  poNumber: string;
  lines: Array<{ lineId: string; description: string; quantity: string; unitPrice: string }>;
}

interface ToolResult {
  toolName: string;
  value: unknown;
}

const STOPWORDS = new Set(["of", "the", "and", "a", "an", "box", "pcs", "for", "with", "per"]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t && !STOPWORDS.has(t))
      .map((t) => t.slice(0, 5)),
  );
}

function similarity(
  inv: AgentTask["lines"][number],
  po: PoDetails["lines"][number],
): number {
  const a = tokens(inv.description);
  const b = tokens(po.description);
  const inter = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size || 1;
  let score = inter / union;
  if (dec(inv.unitPrice).eq(dec(po.unitPrice))) score += 0.5;
  if (dec(inv.quantity).eq(dec(po.quantity))) score += 0.25;
  return score;
}

const ACCEPT = 0.6;
const MARGIN = 0.15;

function mapAgainst(task: AgentTask, po: PoDetails) {
  const used = new Set<string>();
  let total = 0;
  const mappings: AgentProposal["lineMappings"] = [];
  const evidence: AgentProposal["evidence"] = [];
  for (const line of task.lines) {
    let best: { lineId: string; score: number; description: string } | null = null;
    for (const pl of po.lines) {
      if (used.has(pl.lineId)) continue;
      const s = similarity(line, pl);
      if (!best || s > best.score) best = { lineId: pl.lineId, score: s, description: pl.description };
    }
    if (best && best.score >= ACCEPT) {
      used.add(best.lineId);
      total += best.score;
      mappings.push({ invoiceLineId: line.lineId, poLineId: best.lineId });
      evidence.push({
        invoiceLineId: line.lineId,
        poLineId: best.lineId,
        note: `mock heuristic score ${best.score.toFixed(2)}: "${line.description}" ~ "${best.description}"`,
      });
    } else {
      mappings.push({ invoiceLineId: line.lineId, poLineId: null });
      evidence.push({ invoiceLineId: line.lineId, poLineId: null, note: "mock heuristic found no line above threshold" });
    }
  }
  return { mappings, evidence, score: task.lines.length ? total / task.lines.length : 0 };
}

export function mockDecide(task: AgentTask, pos: PoDetails[]): AgentProposal {
  const reasonsPrefix = "[MOCK] deterministic heuristic, not an LLM";
  if (pos.length === 0) {
    return {
      purchaseOrderId: null,
      lineMappings: task.lines.map((l) => ({ invoiceLineId: l.lineId, poLineId: null })),
      confidence: "LOW",
      reasons: [reasonsPrefix, "no purchase order candidates were returned by the tools"],
      evidence: [],
    };
  }
  const ranked = pos
    .map((po) => ({ po, ...mapAgainst(task, po) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const second = ranked[1];
  if (task.fixedPurchaseOrderId) {
    return {
      purchaseOrderId: best.po.id,
      lineMappings: best.mappings,
      confidence: "MEDIUM",
      reasons: [reasonsPrefix, `lines mapped against fixed purchase order ${best.po.poNumber}`],
      evidence: best.evidence,
    };
  }
  if (best.score < ACCEPT) {
    return {
      purchaseOrderId: null,
      lineMappings: task.lines.map((l) => ({ invoiceLineId: l.lineId, poLineId: null })),
      confidence: "LOW",
      reasons: [reasonsPrefix, `best candidate ${best.po.poNumber} scored ${best.score.toFixed(2)} (< ${ACCEPT})`],
      evidence: [],
    };
  }
  if (second && best.score - second.score < MARGIN) {
    return {
      purchaseOrderId: null,
      lineMappings: task.lines.map((l) => ({ invoiceLineId: l.lineId, poLineId: null })),
      confidence: "LOW",
      reasons: [
        reasonsPrefix,
        `candidates ${best.po.poNumber} and ${second.po.poNumber} are equally plausible (${best.score.toFixed(2)} vs ${second.score.toFixed(2)})`,
      ],
      evidence: [],
    };
  }
  return {
    purchaseOrderId: best.po.id,
    lineMappings: best.mappings,
    confidence: "MEDIUM",
    reasons: [reasonsPrefix, `selected ${best.po.poNumber} with score ${best.score.toFixed(2)}`],
    evidence: best.evidence,
  };
}

// ---------------------------------------------------------------------------------------------
// LanguageModelV4 plumbing

function promptText(options: LanguageModelV4CallOptions): string {
  const parts: string[] = [];
  for (const msg of options.prompt) {
    if (msg.role !== "user") continue;
    for (const p of msg.content) if (p.type === "text") parts.push(p.text);
  }
  return parts.join("\n");
}

function toolResults(options: LanguageModelV4CallOptions): ToolResult[] {
  const out: ToolResult[] = [];
  for (const msg of options.prompt) {
    if (msg.role !== "tool") continue;
    for (const p of msg.content) {
      if (p.type !== "tool-result") continue;
      const output = p.output as { type: string; value: unknown };
      let value = output.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          /* keep text */
        }
      }
      out.push({ toolName: p.toolName, value });
    }
  }
  return out;
}

type Plan = { kind: "tools"; calls: Array<{ toolName: string; input: unknown }> } | { kind: "final"; text: string };

let callCounter = 0;

export function planNextStep(options: LanguageModelV4CallOptions): Plan {
  const task = parseTaskFromPrompt(promptText(options));
  if (!task) return { kind: "final", text: JSON.stringify({ error: "mock model received no task" }) };
  const results = toolResults(options);
  const lookups = results.filter((r) => r.toolName === "lookupPurchaseOrders");
  const details = results.filter((r) => r.toolName === "getSupplierAndOrderDetails");

  if (details.length > 0) {
    const pos = details
      .map((d) => d.value as { found: boolean; purchaseOrder: PoDetails | null })
      .filter((d) => d.found && d.purchaseOrder)
      .map((d) => d.purchaseOrder!);
    return { kind: "final", text: JSON.stringify(mockDecide(task, pos)) };
  }
  if (task.fixedPurchaseOrderId) {
    return { kind: "tools", calls: [{ toolName: "getSupplierAndOrderDetails", input: { purchaseOrderId: task.fixedPurchaseOrderId } }] };
  }
  if (lookups.length === 0) {
    return { kind: "tools", calls: [{ toolName: "lookupPurchaseOrders", input: { includeClosed: false, limit: 5 } }] };
  }
  const candidates = ((lookups[0]!.value as { candidates?: Array<{ id: string }> }).candidates ?? []).slice(0, 3);
  if (candidates.length === 0) return { kind: "final", text: JSON.stringify(mockDecide(task, [])) };
  return {
    kind: "tools",
    calls: candidates.map((c) => ({ toolName: "getSupplierAndOrderDetails", input: { purchaseOrderId: c.id } })),
  };
}

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Optional fault injection for tests (simulated outage / rate limit). */
export interface MockModelOptions {
  failWith?: Error;
}

export function createMockModel(opts: MockModelOptions = {}): LanguageModelV4 {
  const content = (plan: Plan): LanguageModelV4Content[] =>
    plan.kind === "final"
      ? [{ type: "text", text: plan.text }]
      : plan.calls.map((c) => ({
          type: "tool-call" as const,
          toolCallId: `mock-call-${++callCounter}`,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        }));

  return {
    specificationVersion: "v4",
    provider: "invoicematch-mock",
    modelId: MOCK_MODEL_ID,
    supportedUrls: {},
    async doGenerate(options): Promise<LanguageModelV4GenerateResult> {
      if (opts.failWith) throw opts.failWith;
      const plan = planNextStep(options);
      return {
        content: content(plan),
        finishReason: { unified: plan.kind === "final" ? "stop" : "tool-calls", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
    async doStream(options) {
      if (opts.failWith) throw opts.failWith;
      const plan = planNextStep(options);
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      parts.push({ type: "response-metadata", id: `mock-resp-${++callCounter}`, modelId: MOCK_MODEL_ID, timestamp: new Date() });
      if (plan.kind === "final") {
        parts.push({ type: "text-start", id: "t0" }, { type: "text-delta", id: "t0", delta: plan.text }, { type: "text-end", id: "t0" });
      } else {
        for (const c of content(plan)) parts.push(c as LanguageModelV4StreamPart);
      }
      parts.push({
        type: "finish",
        usage: USAGE,
        finishReason: { unified: plan.kind === "final" ? "stop" : "tool-calls", raw: undefined },
      });
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  };
}
