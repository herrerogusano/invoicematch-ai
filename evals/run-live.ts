/**
 * LIVE smoke evaluation: a small, explicit sample of agent-dependent scenarios against the real
 * Claude API. Opt-in only, spends API credits, and is bounded by the server-side budget ledger
 * (LLM_BUDGET_USD / LLM_MAX_REQUESTS) on top of the provider-side spend limit.
 *
 *   EVAL_LIVE_CONFIRM=yes npm run eval:live
 *
 * Refuses to run without ANTHROPIC_API_KEY and the explicit confirmation variable.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { loadLocalEnv } from "../scripts/load-env";
loadLocalEnv();

const LIVE_SAMPLE = ["S12-ambiguous-candidates", "S13-agent-selected-po", "S16-semantic-line-mapping"];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("eval:live refused: ANTHROPIC_API_KEY is not set (BLOCKED_CREDITS). No calls made.");
  process.exit(2);
}
if (process.env.EVAL_LIVE_CONFIRM !== "yes") {
  console.error(`eval:live refused: set EVAL_LIVE_CONFIRM=yes to spend credits on ${LIVE_SAMPLE.length} scenarios.`);
  process.exit(2);
}
process.env.AGENT_MODE = "anthropic";

const { prepareScratch, runScenario, scenarios } = await import("./harness");
const { closePool } = await import("../src/db/pool");
const { closeMastraStorage } = await import("../src/mastra/storage");
const { usageSummary } = await import("../src/server/budget");
const { liveModelId } = await import("../src/mastra/agent");

await prepareScratch("invoicematch_eval_live");
const outcomes = [];
for (const s of scenarios.filter((x) => LIVE_SAMPLE.includes(x.id))) {
  const o = await runScenario(s, "live");
  outcomes.push(o);
  console.log(`${o.pass ? "PASS" : "DIFF"} ${o.id} status ${o.actualStatus} (expected ${o.expectedStatus}) rules [${o.actualRuleIds.join(", ")}] tools [${o.toolCalls.join(", ")}]${o.error ? ` error ${o.error}` : ""}`);
}
const usage = await usageSummary();
const report = {
  kind: "live-smoke",
  model: liveModelId(),
  note: "Small live sample. A DIFF is a qualitative signal about LLM selection, not a deterministic-rule failure.",
  finishedAt: new Date().toISOString(),
  usage,
  outcomes,
};
await mkdir("evals/results", { recursive: true });
await writeFile("evals/results/live-latest.json", JSON.stringify(report, null, 2) + "\n");
console.log(`usage: ${usage.requests} requests, est. $${usage.estimatedCostUsd}`);
await closeMastraStorage();
await closePool();
