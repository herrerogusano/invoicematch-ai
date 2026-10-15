import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestExporter } from "@mastra/observability";
import { getReconciliationDetail } from "@/db/repository";
import { registerExporterForTests } from "@/mastra";
import { startReconciliation } from "@/server/reconciliation-service";
import { scenario, setupScratch, teardownScratch } from "./setup";

/**
 * Verifies the instrumentation offline with Mastra's in-memory TestExporter. Delivery to Langfuse
 * Cloud is a separate, credential-dependent check (see docs/evaluation.md).
 */
const exporter = new TestExporter();

beforeAll(async () => {
  registerExporterForTests(exporter);
  await setupScratch("invoicematch_test_tracing");
});
afterAll(teardownScratch);

describe("tracing instrumentation", () => {
  it("records workflow, agent, model and each tool call under one trace stored on the reconciliation", async () => {
    const s = scenario("S13-agent-selected-po");
    const r = await startReconciliation({ invoice: s.invoice, scenarioId: s.id, idempotencyKey: "trace-s13-key", requestedBy: "test" });
    await exporter.flush();
    const spans = exporter.getAllSpans();
    const types = spans.map((sp) => String(sp.type));
    expect(types).toContain("workflow_run");
    expect(types).toContain("agent_run");
    expect(types).toContain("model_generation");
    const toolSpans = spans.filter((sp) => String(sp.type) === "tool_call");
    expect(toolSpans.map((sp) => sp.name).join(" ")).toMatch(/lookupPurchaseOrders/);
    expect(toolSpans.map((sp) => sp.name).join(" ")).toMatch(/getSupplierAndOrderDetails/);

    const d = (await getReconciliationDetail(r.reconciliationId))!;
    expect(d.traceId).toBeTruthy();
    const agentSpan = spans.find((sp) => String(sp.type) === "agent_run")!;
    expect(agentSpan.traceId).toBe(d.traceId);
    // Agent and workflow share a single trace (the agent span is nested in the workflow run).
    const workflowSpan = spans.find((sp) => String(sp.type) === "workflow_run")!;
    expect(workflowSpan.traceId).toBe(agentSpan.traceId);
    // Correlation metadata is attached; no secrets are present in span payloads.
    expect(JSON.stringify(agentSpan.metadata ?? {})).toContain(r.reconciliationId);
    const serialized = JSON.stringify(spans);
    expect(serialized).not.toMatch(/sk-ant-|LANGFUSE_SECRET|OWNER_PASSPHRASE|SESSION_SECRET/);
  });
});
