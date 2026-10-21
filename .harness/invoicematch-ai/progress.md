# Progress: InvoiceMatch AI harness run

Handoff per the Harness Run workflow. Updated 2026-10-21.

## Plan

- Done: steps 0 (research), 1 (skeleton), 2 (DB + engine), 3 (Mastra agent + workflow), 4 (API + UI), 5 (tracing + offline evals), 7 (hardening, CI, docs, private repo + push).
- Done (follow-up 2026-10-15): Langfuse delivery verified with `npm run check:langfuse`; Supabase project `invoicematch-ai` (eu-west-1) created, magic-link sign-in built and verified end to end locally; Supabase Postgres migrated and seeded (`npm run db:cloud`), cross-process HITL verified on it; deployed to https://invoicematch-ai-indol.vercel.app and verified end to end with the owner.
- Done (2026-10-21): promotional API credits claimed. Live smoke 3/3 on claude-haiku-5-5. Production switched to `AGENT_MODE=anthropic` (cap $5 / 400 requests) and redeployed (`dpl_CiPP1G7NAXmRDnqvyApjc7YbUEk2`).
- Vault notes: done. The folder now lives at `C:/Users/herre/dev/invoicematch-ai`. The compose project name is pinned (`name: invoicematch-ai`) so moves no longer orphan the container.

## Outputs

- App: `src/` · migrations: `migrations/` · fixtures: `data/fixtures/` · public samples: `data/samples/precomputed.json`
- Tests: `tests/unit/`, `tests/integration/` · evals: `evals/`, `evals/results/latest.json`
- Docs: `README.md`, `FINAL_REPORT.md`, `docs/*.md`, `docs/screenshots/*.png`
- CI: `.github/workflows/ci.yml` (run 38720997620 green)
- Remote: https://github.com/herrerogusano/invoicematch-ai (private), branch `feature/mvp`

## Decisions (harness-level)

- Mock model implemented as a LanguageModelV4 inside the real Mastra agent loop instead of a separate fake adapter, so offline runs exercise real tool calling.
- Integration tests and evals use scratch databases (`invoicematch_test_*`, `invoicematch_eval`) on the local server.
- Local auth refusal keyed on `VERCEL`/`DEPLOYED` instead of `NODE_ENV` (since `next start` sets production locally).
- Preview MCP snapshots timed out while the T3 window was not visible; replaced by `scripts/screenshots.ts` (playwright-core + installed Chrome).

## Open

- Windows native worker exit seen once in `api-security.test.ts`.
- `npm audit`: moderate `sprintf-js` advisory via Mastra (not reachable).

## Next action

- Verified 2026-10-21: the owner ran S13 in production on the live model and approved it (`APPROVED_WITH_EXCEPTION`). The ledger recorded 3 requests, 4924 input / 779 output tokens, $0.00088. The Langfuse trace `5506085ecf789ec45c8800c313d2a495` (environment `production`) has 34 observations, 3 generations with usage and cost, and both tools. The Vercel deploy token was revoked afterwards (API returns 403).
- Promotional credits expire 2026-11-12 and the API key expires 2026-11-20. After that, live runs end in an explicit `FAILED` state. Either set Vercel `AGENT_MODE=mock` and redeploy, or add credits and a new key.
- Still open: PR or merge of `feature/mvp` into `main`, and whether to connect Vercel to GitHub.
