/**
 * Pulls the benchmark's metrics back out of Langfuse (not from the local result files), so the
 * analysis can be checked against the observability backend:
 *
 *   npm run eval:bench:langfuse -- haiku-v1-baseline haiku-v2-final sonnet-v2
 *
 * Per run label: traces and their latency (root observations tagged run:<label>), model
 * generations with tokens, cost and latency (environment agent-bench, inside the run's time
 * window), tool calls by name, and the bench_* scores. Writes evals/results/agent-bench-langfuse.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { loadLocalEnv } from "../../scripts/load-env";
import { queryMetrics } from "./langfuse";

loadLocalEnv();

const labels = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!labels.length) {
  console.error("usage: npm run eval:bench:langfuse -- <label> [label...]");
  process.exit(2);
}

const env = { column: "environment", operator: "=", value: "agent-bench", type: "string" };
const tag = (label: string) => ({ column: "tags", operator: "any of", value: [`run:${label}`], type: "arrayOptions" });

const out: Record<string, unknown> = {};
for (const label of labels) {
  const r = JSON.parse(await readFile(`evals/results/agent-bench/${label}.json`, "utf8")) as { startedAt: string; finishedAt: string; runs: unknown[] };
  // startedAt is taken before the scratch database is built and finishedAt after the last run,
  // so every span of the run starts inside [startedAt, finishedAt]. Runs never overlap.
  const window = { fromTimestamp: r.startedAt, toTimestamp: new Date(Date.parse(r.finishedAt) + 5_000).toISOString() };
  const [traces, generations, tools, booleans, numeric, outcomes] = await Promise.all([
    queryMetrics({
      ...window, view: "observations",
      metrics: [{ measure: "count", aggregation: "count" }, { measure: "latency", aggregation: "p50" }, { measure: "latency", aggregation: "p95" }, { measure: "latency", aggregation: "avg" }],
      dimensions: [],
      filters: [env, tag(label), { column: "isRootObservation", operator: "=", value: true, type: "boolean" }],
    }),
    queryMetrics({
      ...window, view: "observations",
      metrics: [
        { measure: "count", aggregation: "count" }, { measure: "inputTokens", aggregation: "sum" }, { measure: "outputTokens", aggregation: "sum" },
        { measure: "totalCost", aggregation: "sum" }, { measure: "latency", aggregation: "p50" }, { measure: "latency", aggregation: "p95" },
      ],
      dimensions: [{ field: "providedModelName" }, { field: "name" }],
      filters: [env, { column: "type", operator: "=", value: "GENERATION", type: "string" }],
    }),
    queryMetrics({
      ...window, view: "observations",
      metrics: [{ measure: "count", aggregation: "count" }, { measure: "latency", aggregation: "p50" }],
      dimensions: [{ field: "name" }, { field: "type" }],
      filters: [env, { column: "type", operator: "=", value: "TOOL", type: "string" }],
    }),
    queryMetrics({
      ...window, view: "scores-boolean",
      metrics: [{ measure: "value", aggregation: "avg" }, { measure: "count", aggregation: "count" }],
      dimensions: [{ field: "name" }],
      filters: [env, tag(label)],
    }),
    queryMetrics({
      ...window, view: "scores-numeric",
      metrics: [{ measure: "value", aggregation: "avg" }, { measure: "count", aggregation: "count" }],
      dimensions: [{ field: "name" }],
      filters: [env, tag(label), { column: "dataType", operator: "=", value: "NUMERIC", type: "string" }],
    }),
    queryMetrics({
      ...window, view: "scores-categorical",
      metrics: [{ measure: "count", aggregation: "count" }],
      dimensions: [{ field: "stringValue" }],
      filters: [env, tag(label), { column: "name", operator: "=", value: "bench_outcome", type: "string" }],
    }),
  ]);
  out[label] = { window, localRuns: r.runs.length, traces, generations, tools, booleans, numeric, outcomes };
  console.log(`\n## ${label} (${r.runs.length} local runs)`);
  console.log("traces:", JSON.stringify(traces));
  console.log("generations:", JSON.stringify(generations));
  console.log("tools:", JSON.stringify(tools));
  console.log("boolean scores:", JSON.stringify(booleans));
  console.log("numeric scores:", JSON.stringify(numeric));
  console.log("outcomes:", JSON.stringify(outcomes));
}
await writeFile("evals/results/agent-bench-langfuse.json", JSON.stringify({ queriedAt: new Date().toISOString(), runs: out }, null, 2) + "\n");
console.log("\nwrote evals/results/agent-bench-langfuse.json");
