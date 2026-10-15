/**
 * Offline evaluation: every labeled scenario through the real Mastra workflow and agent loop with
 * the MOCK model (AGENT_MODE forced to "mock"), against a scratch local database.
 * Scores the deterministic pipeline (status + exact rule IDs). It is not an LLM benchmark.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { loadLocalEnv } from "../scripts/load-env";
loadLocalEnv();
process.env.AGENT_MODE = "mock";

const { prepareScratch, runScenario, scenarios } = await import("./harness");
const { closePool } = await import("../src/db/pool");
const { closeMastraStorage } = await import("../src/mastra/storage");

const started = new Date();
await prepareScratch("invoicematch_eval");
const outcomes = [];
const samples = [];
const { getReconciliationDetail } = await import("../src/db/repository");
for (const s of scenarios) {
  const o = await runScenario(s, "offline");
  outcomes.push(o);
  const d = o.reconciliationId ? await getReconciliationDetail(o.reconciliationId) : null;
  if (d?.result) {
    samples.push({
      scenarioId: s.id,
      title: s.title,
      summary: s.summary,
      invoiceNumber: d.invoiceNumber,
      supplierName: d.supplierName,
      poNumber: d.poNumber,
      currency: d.currency,
      status: d.status,
      result: d.result,
      agent: { invoked: d.agentInvoked, mode: d.agentMode, toolCalls: o.toolCalls },
    });
  }
  console.log(`${o.pass ? "PASS" : "FAIL"} ${o.id.padEnd(28)} expected ${o.expectedStatus.padEnd(16)} got ${o.actualStatus.padEnd(16)} rules [${o.actualRuleIds.join(", ")}]${o.agentInvoked ? `  agent(mock): ${o.toolCalls.join(", ")}` : ""}${o.error ? `  error: ${o.error}` : ""}`);
}
const passed = outcomes.filter((o) => o.pass).length;
const report = {
  kind: "offline-deterministic",
  disclaimer: "Agent decisions come from a scripted MOCK model (invoicematch-mock-v1) running inside the real Mastra agent loop. Not LLM evidence.",
  startedAt: started.toISOString(),
  finishedAt: new Date().toISOString(),
  scenarioFileVersion: 1,
  score: `${passed} / ${outcomes.length}`,
  failed: outcomes.filter((o) => !o.pass).map((o) => o.id),
  outcomes,
};
await mkdir("evals/results", { recursive: true });
await writeFile("evals/results/latest.json", JSON.stringify(report, null, 2) + "\n");
await mkdir("data/samples", { recursive: true });
await writeFile(
  "data/samples/precomputed.json",
  JSON.stringify(
    {
      generatedAt: report.finishedAt,
      generator: "npm run eval:offline",
      disclaimer:
        "Precomputed with the scripted MOCK agent model on synthetic data. Deterministic rules are real; agent choices are not LLM output.",
      samples,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nscore ${report.score}${report.failed.length ? ` failed: ${report.failed.join(", ")}` : ""}`);
await closeMastraStorage();
await closePool();
process.exit(report.failed.length ? 1 : 0);
