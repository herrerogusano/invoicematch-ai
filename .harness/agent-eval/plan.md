# Plan: agent evaluation and improvement (harness run, 2026-10-27)

## Task

Measure how well the reconciliation agent picks purchase orders and maps lines with real Claude, improve it from the failures, compare Haiku 5.5 with Sonnet 5.5, and write an analysis backed by Langfuse metrics.

## Inputs fixed by the owner (2026-10-27)

- Spend cap for the whole run: **$3** of promotional credits, enforced by the runner before every call.
- Autonomy: everything, including merging to `main`, if CI passes and the metrics improve **without** a higher wrong-pick rate. Otherwise leave the PR open and explain.
- The deliverable includes an analysis with Langfuse metrics.

## Acceptance criteria

1. A labeled agent benchmark of 30–40 cases, in a catalog separate from the public demo data, with a dev/test split.
2. Repeated runs (Haiku ×5 baseline and final; Sonnet ×2) with separate metrics: PO accuracy, wrong-pick rate, over-abstention, end-to-end line precision/recall/F1, consistency across repetitions, errors, tokens, cost and latency.
3. Every run is traced in Langfuse (environment `agent-bench`, tags with run label and model) and carries scores per trace.
4. Improvements are general (prompt, tool or limits), never case-specific. Decisions are made on the dev split only; the test split is the headline.
5. The final report (`docs/agent-evaluation.md`) includes the Langfuse metrics and the cost of the whole run.
6. Existing checks stay green: lint, typecheck, unit, integration, offline eval 16/16, secrets, build, CI.

## Steps

| # | Step | Files | Check (defined before the work) | Parallel |
|---|---|---|---|---|
| 0 | Connectivity: Anthropic models endpoint, Langfuse projects and scores endpoints | — | HTTP 200 on each | — |
| 1 | Benchmark data: catalog + 36 labeled cases (search, abstain, fixed-PO mapping, wrong reference, injection, >5 candidates) | `data/agent-bench/*.json`, `src/fixtures/agent-bench.ts` | Zod parse; every expected PO/line exists and belongs to the supplier; unit test | no |
| 2 | Plumbing: `seed(catalog)` parameter, tracing tags/metadata on `startReconciliation`, `LANGFUSE_ENVIRONMENT`, Sonnet 5.5 price | `src/db/seed.ts`, `src/server/reconciliation-service.ts`, `src/mastra/index.ts`, `src/server/budget.ts` | existing unit + integration suites unchanged and green | no |
| 3 | Runner + scorer: reps, split, concurrency, global $ cap from previous result files, Langfuse scores | `evals/agent-bench/*.ts`, `package.json` | scorer unit tests; free mock run end to end | no |
| 4 | Baseline: Haiku 5.5 ×5 on all cases | `evals/results/agent-bench/` | report written; spend within cap | — |
| 5 | Error analysis on dev failures → general fixes → dev re-runs (max 3 iterations) | `src/mastra/*` | dev metrics up, wrong-pick not up; offline eval still 16/16 | — |
| 6 | Final Haiku ×5 on all cases (test split is the headline); Sonnet 5.5 ×2 on all cases | results | within cap | — |
| 7 | Langfuse analysis: metrics/scores/observations per run label | `evals/agent-bench/langfuse-report.ts`, `docs/agent-evaluation.md` | numbers in the report come from the Langfuse API, not from memory | — |
| 8 | Integrate: full checks, PR, CI, merge if criteria hold; README/eval docs; vault STATUS | repo docs | all green; `git status` clean | — |

## Cost estimate

Haiku ≈ $0.001 per run; Sonnet ≈ $0.02 per run. 180 + ~110 + 180 Haiku runs ≈ $0.5; 72 Sonnet runs ≈ $1.5. Total ≈ $2, under the $3 cap.

## Estimate (human hours, senior developer)

Benchmark design and labeling 4 h, runner and scoring 4 h, runs and error analysis 4 h, Langfuse analysis and report 3 h, integration 1 h: about 16 h.
