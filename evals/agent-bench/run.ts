/**
 * Agent benchmark: runs labeled cases through the real workflow (real agent, real tools, real
 * Postgres) and scores PO selection and line mapping. Live runs spend API credits and need
 * EVAL_LIVE_CONFIRM=yes; a global cap (EVAL_BENCH_BUDGET_USD, default $3) covers every run
 * recorded in evals/results/agent-bench/.
 *
 *   npm run eval:bench -- --label haiku-v1-baseline --reps 5
 *   npm run eval:bench -- --label dryrun --mock --reps 1
 *
 * Options: --label <name> (required) --reps <n> --split dev|test|all --cases <id,id> --concurrency <n>
 *          --model <id> --mock
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { loadLocalEnv } from "../../scripts/load-env";
import { aggregate, decisionSignature, scoreRun, type Actual, type Aggregate, type RunRow } from "./score";
import { postScores, type ScoreInput } from "./langfuse";

loadLocalEnv();

const RESULTS_DIR = "evals/results/agent-bench";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const label = arg("label");
if (!label || !/^[a-z0-9][a-z0-9.-]{2,60}$/.test(label)) {
  console.error("--label <lowercase-name> is required (letters, digits, dots, hyphens)");
  process.exit(2);
}
const mock = flag("mock");
const reps = Number(arg("reps") ?? 1);
const split = arg("split") ?? "all";
const concurrency = Number(arg("concurrency") ?? 3);
const onlyCases = arg("cases")?.split(",");
if (!Number.isInteger(reps) || reps < 1 || reps > 10) throw new Error("--reps must be 1..10");
if (!["dev", "test", "all"].includes(split)) throw new Error("--split must be dev, test or all");

if (mock) {
  process.env.AGENT_MODE = "mock";
} else {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("eval:bench refused: ANTHROPIC_API_KEY is not set in the environment, .env.local or .env. No calls made.");
    process.exit(2);
  }
  if (process.env.EVAL_LIVE_CONFIRM !== "yes") {
    console.error("eval:bench refused: set EVAL_LIVE_CONFIRM=yes to spend credits (or pass --mock).");
    process.exit(2);
  }
  process.env.AGENT_MODE = "anthropic";
  if (arg("model")) process.env.ANTHROPIC_MODEL = arg("model");
}
process.env.LANGFUSE_ENVIRONMENT = "agent-bench";

/** Measured spend of every live benchmark run already recorded. */
async function spentSoFar(): Promise<number> {
  const files = await readdir(RESULTS_DIR).catch(() => [] as string[]);
  let total = 0;
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    const r = JSON.parse(await readFile(`${RESULTS_DIR}/${f}`, "utf8")) as { mode?: string; label?: string; spend?: { ledgerUsd?: number } };
    if (r.label === label) throw new Error(`a result for label ${label} already exists; pick a new label`);
    if (r.mode === "anthropic") total += r.spend?.ledgerUsd ?? 0;
  }
  return total;
}

const budgetUsd = Number(process.env.EVAL_BENCH_BUDGET_USD ?? 3);
const spent = await spentSoFar();
const remaining = budgetUsd - spent;
if (!mock && remaining <= 0.05) {
  console.error(`eval:bench refused: benchmark budget used ($${spent.toFixed(4)} of $${budgetUsd}).`);
  process.exit(2);
}
// The scratch database starts with an empty ledger, so the per-run ledger cap is the global remainder.
process.env.LLM_BUDGET_USD = String(Math.max(0, remaining));
process.env.LLM_MAX_REQUESTS = "100000";

const { createScratchDatabase } = await import("../../src/db/scratch");
const { migrate } = await import("../../src/db/migrate");
const { seed } = await import("../../src/db/seed");
const { initMastraStorage, closeMastraStorage } = await import("../../src/mastra/storage");
const { getPool, closePool } = await import("../../src/db/pool");
const { getReconciliationDetail } = await import("../../src/db/repository");
const { startReconciliation } = await import("../../src/server/reconciliation-service");
const { getMastra } = await import("../../src/mastra");
const { liveModelId, PROMPT_VERSION } = await import("../../src/mastra/agent");
const { estimateCostUsd } = await import("../../src/server/budget");
const { benchCases, benchCatalog } = await import("../../src/fixtures/agent-bench");

const model = mock ? "invoicematch-mock-v1" : liveModelId();
const startedAt = new Date().toISOString();
await createScratchDatabase("invoicematch_agent_bench");
await migrate(() => undefined);
await initMastraStorage();
await seed(() => undefined, benchCatalog);

const cases = benchCases.filter((c) => (split === "all" || c.split === split) && (!onlyCases || onlyCases.some((id) => c.id.startsWith(id))));
const jobs = cases.flatMap((c) => Array.from({ length: reps }, (_, i) => ({ c, rep: i + 1 })));
console.log(`agent bench "${label}": ${cases.length} cases x ${reps} reps = ${jobs.length} runs, model ${model}, prompt ${PROMPT_VERSION}${mock ? " (MOCK)" : `, budget left $${remaining.toFixed(4)}`}`);

interface Row extends RunRow {
  traceId: string;
  actual: Actual;
  toolCalls: string[];
}
const rows: Row[] = [];
const queue = [...jobs];
let done = 0;

async function runOne({ c, rep }: (typeof jobs)[number]): Promise<Row> {
  const traceId = randomBytes(16).toString("hex");
  const started = Date.now();
  const r = await startReconciliation({
    invoice: c.invoice,
    scenarioId: c.id,
    idempotencyKey: `bench-${label}-${c.id}-r${rep}`,
    requestedBy: "agent-bench",
    tracing: {
      tags: ["agent-bench", `run:${label}`, `model:${model}`, `prompt:${PROMPT_VERSION}`, `split:${c.split}`, `category:${c.category}`],
      metadata: { benchRun: label, caseId: c.id, rep, split: c.split, category: c.category, model, promptVersion: PROMPT_VERSION },
      traceId,
    },
  });
  const latencyMs = Date.now() - started;
  const d = await getReconciliationDetail(r.reconciliationId);
  const lines: Record<string, string | null> = {};
  for (const l of d?.result?.lines ?? []) if (l.invoiceLineId) lines[l.invoiceLineId] = l.poLineId;
  const actual: Actual = { status: r.status, errorCode: d?.errorCode ?? null, errorMessage: d?.errorMessage ?? null, poNumber: d?.poNumber ?? null, lines };
  const agentEvent = d?.events.find((e) => e.eventType === "AGENT_STEP")?.payload as { confidence?: string | null; toolCalls?: string[] } | undefined;
  const { rows: usage } = await getPool().query<{ i: string; o: string; n: string; usd: string }>(
    `select coalesce(sum(input_tokens),0) i, coalesce(sum(output_tokens),0) o, coalesce(sum(request_count),0) n, coalesce(sum(estimated_cost_usd),0) usd
       from app.llm_usage where reconciliation_id = $1`,
    [r.reconciliationId],
  );
  const inputTokens = Number(usage[0]!.i);
  const outputTokens = Number(usage[0]!.o);
  return {
    caseId: c.id,
    split: c.split,
    category: c.category,
    fixedPo: c.fixedPo,
    rep,
    score: scoreRun(c.expected, c.fixedPo, actual),
    signature: decisionSignature(actual),
    confidence: agentEvent?.confidence ?? null,
    inputTokens,
    outputTokens,
    requests: Number(usage[0]!.n),
    costUsd: mock ? 0 : estimateCostUsd(model, inputTokens, outputTokens),
    latencyMs,
    traceId,
    actual,
    toolCalls: agentEvent?.toolCalls ?? [],
  };
}

async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const row = await runOne(job);
    rows.push(row);
    done++;
    const s = row.score;
    console.log(`[${done}/${jobs.length}] ${row.caseId} r${row.rep} ${s.outcome.padEnd(15)} lineF1 ${s.lineF1.toFixed(2)} ${row.confidence ?? "-"} ${row.latencyMs} ms${row.actual.errorCode ? ` ${row.actual.errorCode}` : ""}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));
rows.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.rep - b.rep);

const { rows: ledger } = await getPool().query<{ usd: string; n: string }>(
  "select coalesce(sum(estimated_cost_usd),0) usd, coalesce(sum(request_count),0) n from app.llm_usage",
);
const ledgerUsd = Number(ledger[0]!.usd);

const bySplit: Record<string, Aggregate> = { all: aggregate(rows) };
for (const s of ["dev", "test"]) if (rows.some((r) => r.split === s)) bySplit[s] = aggregate(rows.filter((r) => r.split === s));
const byCategory: Record<string, Aggregate> = {};
for (const cat of [...new Set(rows.map((r) => r.category))]) byCategory[cat] = aggregate(rows.filter((r) => r.category === cat));

const scores: ScoreInput[] = rows.flatMap((r) => [
  { traceId: r.traceId, name: "bench_outcome", value: r.score.outcome, dataType: "CATEGORICAL" as const, comment: r.caseId },
  { traceId: r.traceId, name: "bench_exact", value: r.score.exact ? 1 : 0, dataType: "BOOLEAN" as const },
  { traceId: r.traceId, name: "bench_line_f1", value: Number(r.score.lineF1.toFixed(4)), dataType: "NUMERIC" as const },
  ...(r.fixedPo
    ? []
    : [
        { traceId: r.traceId, name: "bench_po_correct", value: r.score.poCorrect ? 1 : 0, dataType: "BOOLEAN" as const },
        { traceId: r.traceId, name: "bench_wrong_pick", value: r.score.wrongPick ? 1 : 0, dataType: "BOOLEAN" as const },
      ]),
]);
const posted = await postScores(scores, "agent-bench");

const report = {
  kind: "agent-bench",
  label,
  mode: mock ? "mock" : "anthropic",
  model,
  promptVersion: PROMPT_VERSION,
  reps,
  split,
  startedAt,
  finishedAt: new Date().toISOString(),
  spend: { ledgerUsd, ledgerRequests: Number(ledger[0]!.n), measuredUsd: bySplit.all!.costUsd, budgetUsd, spentBeforeUsd: spent },
  langfuse: { environment: "agent-bench", tag: `run:${label}`, scoresPosted: posted.ok, scoresFailed: posted.failed },
  aggregate: bySplit,
  byCategory,
  runs: rows.map(({ actual, ...r }) => ({ ...r, status: actual.status, errorCode: actual.errorCode, poNumber: actual.poNumber, lines: actual.lines })),
};
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(`${RESULTS_DIR}/${label}.json`, JSON.stringify(report, null, 2) + "\n");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
for (const [k, a] of Object.entries(bySplit)) {
  console.log(
    `${k.padEnd(4)} runs ${a.runs}  PO acc ${pct(a.poAccuracy)}  wrong-pick ${pct(a.wrongPickRate)}  over-abstain ${pct(a.overAbstainRate)}  errors ${pct(a.errorRate)}  line F1 ${a.lineF1.toFixed(3)}  exact ${pct(a.exactRate)}  agreement ${a.meanAgreement.toFixed(3)}  $${a.costUsd.toFixed(4)}  p50 ${a.latencyP50Ms} ms`,
  );
}
console.log(`ledger $${ledgerUsd.toFixed(4)} (${ledger[0]!.n} requests); Langfuse scores ${posted.ok} ok, ${posted.failed} failed; ${RESULTS_DIR}/${label}.json`);

await getMastra().shutdown();
await closeMastraStorage();
await closePool();
