# Progress: agent evaluation harness run (2026-10-27)

## Plan status

- Done: steps 0–7 (connectivity, benchmark, plumbing, runner + scorer, baseline, two improvement iterations, final Haiku and Sonnet runs, Langfuse analysis).
- Step 8 (integration: full checks, PR, CI, merge) in progress at the time of writing; see the PR for its result.
- The owner pre-approved the run (2026-10-27): $3 cap, autonomous including merge if CI passes and metrics improve without more wrong picks.

## Outputs

- Benchmark: `data/agent-bench/catalog.json`, `data/agent-bench/cases.json`, loader `src/fixtures/agent-bench.ts`.
- Runner and scoring: `evals/agent-bench/run.ts`, `score.ts`, `langfuse.ts`, `langfuse-report.ts`; scripts `eval:bench`, `eval:bench:langfuse`.
- Results: `evals/results/agent-bench/*.json` (one file per run label), `evals/results/agent-bench-langfuse.json`.
- Report: `docs/agent-evaluation.md`.
- Agent changes: prompt v3 (`src/mastra/agent.ts`, `contracts.ts`), paging and line summaries in `lookupPurchaseOrders` (`src/mastra/tools.ts`, `src/db/repository.ts`), balanced JSON extraction.

## Decisions

- Separate benchmark catalog, so the demo data and the 16 offline scenarios are unchanged.
- Score what the workflow kept (PO and mapping after validation), not raw model text; a PO the workflow rejects counts as a wrong pick.
- Langfuse experiments (v4) need OTel experiment attributes that Mastra's exporter does not set; used trace tags + per-trace scores + Metrics API v2 instead. Tags exist only on root observations, so generation/tool metrics use the environment and the run's time window.
- Production stays on Haiku 5.5: Sonnet 5.5 was not more accurate on this set and costs about 19× more per run.

## Open

- The benchmark is saturated (100 %); harder cases are the next step (`docs/agent-evaluation.md#next-steps`).
- Malformed final output was 2/180 in v2 and 0/180 in v3; structured outputs would remove the class.
- Langfuse ingestion lost about 6 % of the baseline's traces (rate limiting during scoring); later runs complete within 1–4 %.

## Next action

- After merge: verify production health and run one owner reconciliation (S13) on prompt v3.
