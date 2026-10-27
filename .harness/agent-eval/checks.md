# Checks: agent evaluation harness run (2026-10-27)

Verdict: `pass`, `fail` or `unresolved`. Evidence is a command or test actually run in this session.

| step | requirement | verdict | evidence |
|---|---|---|---|
| 0 | Anthropic API reachable with the production key | pass | `GET /v1/models` → 200 |
| 0 | Langfuse project, scores and metrics endpoints reachable | pass | `projects list` → 200 (`invoicematch-ai`); `POST /api/public/scores` accepted (after 429 back-off); `GET /api/public/v2/metrics` with tag filter → rows |
| 1 | 30–40 labeled cases, dev/test split, separate catalog | pass | 36 cases (18 dev / 18 test), 24 POs in `data/agent-bench/catalog.json`; loader validates every label against the catalog at import |
| 1 | Labels cannot point outside the supplier's open POs | pass | `tests/unit/agent-bench.test.ts` "rejects labels…" |
| 2 | Plumbing does not change existing behavior | pass | `npm run typecheck`, lint; full suites re-run in step 8 |
| 3 | Scorer correct on hand-made cases | pass | `tests/unit/agent-bench.test.ts` 7/7 (wrong pick vs over-abstain vs error, invalid-PO as wrong pick, fixed-PO, agreement, aggregates) |
| 3 | Runner end to end without spend | pass | `npm run eval:bench -- --label mock-dryrun --mock`: 36 runs, traces in Langfuse env `agent-bench` with the runner's trace id; 156/164 scores posted, 8 hit HTTP 429 → retry with `retryAfterSeconds` added |
| 4 | Baseline recorded within the cap | pass | `haiku-v1-baseline`: 180 runs, PO acc 92.9 % (dev and test), 0 wrong picks, $0.196; failures only B17/B18 (right PO beyond the 5-candidate page) |
| 5 | Dev metrics up, wrong-pick not up, offline eval intact (v2: paging + line summaries) | pass | `haiku-v2-dev` 54/54 exact, $0.00077/run vs $0.00111; `npm run eval:offline` 16/16; new integration test "pages through candidates…" |
| 5 | v3 (open-only rule) fixes the dev finding without regressions | pass | `sonnet-v3-a03` 3/3 correct abstain (was 3/3 closed-PO pick); `haiku-v3-final` 180/180 exact |
| 5 | Parser fix verified on the real failing output | pass | B19 output replayed from Langfuse parses with the new extractor; B20 (wrong key) still rejected by Zod, by design; unit tests in `status-and-mock.test.ts` |
| 6 | Final Haiku ×5 and Sonnet comparison within the cap | pass | `haiku-v3-final` test split 100 % PO acc, 0 wrong picks, $0.141; `sonnet-v2-final` 108 runs $1.629; total ledger spend $2.234 of $3 |
| 7 | Report numbers come from the Langfuse API | pass | `npm run eval:bench:langfuse` → `evals/results/agent-bench-langfuse.json` (traces, generations, tool spans, scores per run label); coverage noted (baseline ~94 %, later runs 96–100 %) |
| 7 | Improvement criteria for merging met | pass | test-split PO accuracy 92.9 % → 100 %, wrong-pick rate 0 % → 0 %, exact 94.4 % → 100 % |
