import { loadLocalEnv } from "./load-env";

/**
 * End-to-end Langfuse delivery check. Runs one mock reconciliation (S13, agent + both tools) on a
 * local scratch database with the real Langfuse exporter, flushes, then polls the Langfuse public
 * API for that trace id. Uses the mock model, so it spends no LLM credits. Keys are read from
 * .env.local and never printed.
 */
loadLocalEnv();
process.env.AGENT_MODE = "mock";

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;
const baseUrl = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
if (!publicKey || !secretKey) {
  console.error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set in .env.local");
  process.exit(2);
}
const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

async function api(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: auth } });
}

async function main(): Promise<void> {
  // Fail fast on wrong keys or region before running anything.
  const probe = await api("/api/public/projects");
  if (!probe.ok)
    throw new Error(
      `Langfuse auth failed (${probe.status}); check the keys and LANGFUSE_BASE_URL region`,
    );

  const { prepareScratch } = await import("../evals/harness");
  const { getReconciliationDetail } = await import("@/db/repository");
  const { startReconciliation } = await import("@/server/reconciliation-service");
  const { getMastra, langfuseConfigured } = await import("@/mastra");
  const { getScenario } = await import("@/fixtures");
  const { closePool } = await import("@/db/pool");
  const { closeMastraStorage } = await import("@/mastra/storage");
  if (!langfuseConfigured()) throw new Error("Langfuse exporter is not configured");

  await prepareScratch("invoicematch_langfuse_check");
  const s = getScenario("S13-agent-selected-po");
  if (!s) throw new Error("scenario S13 missing");
  const r = await startReconciliation({
    invoice: s.invoice,
    scenarioId: s.id,
    idempotencyKey: `langfuse-check-${Date.now()}`,
    requestedBy: "langfuse-check",
  });
  const traceId = (await getReconciliationDetail(r.reconciliationId))?.traceId;
  if (!traceId) throw new Error("no trace id stored on the reconciliation");
  await getMastra().shutdown();
  await closeMastraStorage();
  await closePool();
  console.log(`reconciliation ${r.reconciliationId} -> ${r.status}, trace ${traceId}`);

  // Ingestion is asynchronous; poll for up to ~90 s.
  for (let i = 0; i < 18; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    // Organizations created after 2026-09-16 only expose the v2 observations API.
    const res = await api(`/api/public/v2/observations?traceId=${traceId}&limit=100`);
    if (res.ok) {
      const obs =
        ((await res.json()) as { data?: Array<{ type?: string; name?: string }> }).data ?? [];
      const names = obs.map((o) => o.name ?? "").join(" ");
      const tools = ["lookupPurchaseOrders", "getSupplierAndOrderDetails"].filter((t) =>
        names.includes(t),
      );
      const generations = obs.filter((o) => o.type === "GENERATION").length;
      // Observations arrive in batches; keep polling until the agent's spans are in.
      if (tools.length < 2 || generations === 0) continue;
      console.log(
        `Langfuse trace found: ${obs.length} observations, ${generations} generation(s), tools: ${tools.join(", ") || "none"}`,
      );
      if (process.env.LANGFUSE_PROJECT_URL)
        console.log(`${process.env.LANGFUSE_PROJECT_URL.replace(/\/+$/, "")}/traces/${traceId}`);
      console.log("PASS");
      return;
    }
    if (res.status !== 404) throw new Error(`Langfuse API returned ${res.status}`);
  }
  throw new Error(
    "complete trace (agent, model and both tools) not visible in Langfuse after 90 s",
  );
}

main().catch((err: unknown) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
