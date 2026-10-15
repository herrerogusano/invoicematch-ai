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
for (const s of scenarios) {
  const o = await runScenario(s, "offline");
  outcomes.push(o);
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
console.log(`\nscore ${report.score}${report.failed.length ? ` failed: ${report.failed.join(", ")}` : ""}`);
await closeMastraStorage();
await closePool();
process.exit(report.failed.length ? 1 : 0);
