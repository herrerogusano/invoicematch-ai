import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { getReconciliationDetail } from "@/db/repository";
import { setAgentModelForTests } from "@/mastra/agent";
import { createMockModel } from "@/mastra/mock-model";
import { decideReview, startReconciliation } from "@/server/reconciliation-service";
import { count, scenario, setupScratch, teardownScratch } from "./setup";

beforeAll(async () => {
  await setupScratch("invoicematch_test_failures");
});
afterEach(() => {
  setAgentModelForTests(null);
  process.env.AGENT_MODE = "mock";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_MAX_REQUESTS;
});
afterAll(teardownScratch);

let n = 0;
async function runAgentScenario() {
  // S13 has no PO reference and no SKUs, so the agent is always invoked.
  const s = scenario("S13-agent-selected-po");
  const r = await startReconciliation({
    invoice: { ...s.invoice, invoiceNumber: `INV-FAIL-${++n}` },
    scenarioId: s.id,
    idempotencyKey: `fail-${n}-${Date.now()}`,
    requestedBy: "test",
  });
  return (await getReconciliationDetail(r.reconciliationId))!;
}

function textModel(text: string): LanguageModelV4 {
  const base = createMockModel();
  const reply = async () => ({
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
    warnings: [],
  });
  return {
    ...base,
    doGenerate: reply,
    async doStream() {
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: text });
            c.enqueue({ type: "text-end", id: "t" });
            c.enqueue({ type: "finish", usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } }, finishReason: { unified: "stop", raw: undefined } });
            c.close();
          },
        }),
      };
    },
  };
}

describe("model failures produce explicit states and never a fake match", () => {
  it("simulated outage → FAILED with MODEL_UNAVAILABLE, no findings, not reviewable", async () => {
    setAgentModelForTests(createMockModel({ failWith: Object.assign(new Error("simulated overload"), { statusCode: 529 }) }));
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("MODEL_UNAVAILABLE");
    expect(d.result).toBeNull();
    expect(d.purchaseOrderId).toBeNull();
    await expect(
      decideReview(d.id, { decision: "APPROVE", reason: "cannot approve a failed run", idempotencyKey: `fail-approve-${d.id}` }, "o@example.com"),
    ).rejects.toMatchObject({ code: "NOT_PENDING_REVIEW" });
  });

  it("simulated rate limit → FAILED with MODEL_RATE_LIMITED", async () => {
    setAgentModelForTests(createMockModel({ failWith: Object.assign(new Error("rate limited"), { statusCode: 429 }) }));
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("MODEL_RATE_LIMITED");
  });

  it("non-JSON model output → FAILED with AGENT_INVALID_OUTPUT", async () => {
    setAgentModelForTests(textModel("I believe it is probably PO-3001."));
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("AGENT_INVALID_OUTPUT");
  });

  it("hallucinated purchase order id → FAILED, never used", async () => {
    setAgentModelForTests(
      textModel(JSON.stringify({ purchaseOrderId: "00000000-0000-4000-8000-000000000000", lineMappings: [], confidence: "HIGH", reasons: ["made up"], evidence: [] })),
    );
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("AGENT_INVALID_OUTPUT");
    expect(d.purchaseOrderId).toBeNull();
  });

  it("live mode without an API key fails closed before any reservation or call", async () => {
    process.env.AGENT_MODE = "anthropic";
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("AGENT_NOT_CONFIGURED");
    expect(await count("select count(*) as n from app.llm_usage")).toBe(0);
  });

  it("exhausted budget refuses the live call before any network request", async () => {
    process.env.AGENT_MODE = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
    process.env.LLM_MAX_REQUESTS = "0";
    const d = await runAgentScenario();
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("BUDGET_EXCEEDED");
    expect(await count("select count(*) as n from app.llm_usage")).toBe(0);
  });
});
