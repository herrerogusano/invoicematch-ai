# Progress: InvoiceMatch AI harness run

Handoff per the Harness Run workflow. Updated 2026-10-15 12:40.

## Plan

- Done: steps 0 (research), 1 (skeleton), 2 (DB + engine), 3 (Mastra agent + workflow), 4 (API + UI), 5 (tracing + offline evals), 7 (hardening, CI, docs, private repo + push).
- Done (follow-up 2026-10-15): Langfuse delivery verified with `npm run check:langfuse`.
- Blocked: step 5 live smoke (BLOCKED_CREDITS), step 6 deployment (local-only decision; Supabase/Vercel need owner).
- Vault notes: done. Folder rename `Nueva carpeta` → `invoicematch-ai`: FAILED (Windows lock held by the running Claude session itself); the owner renames it after closing the session. Git is unaffected.

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
- Supabase magic-link UI not built.
- `npm audit`: moderate `sprintf-js` advisory via Mastra (not reachable).

## Next action

When credits exist (from 2026-10-16): confirm budget cap, set `ANTHROPIC_API_KEY` in `.env.local`, run `EVAL_LIVE_CONFIRM=yes npm run eval:live`, record the results in `docs/evaluation.md`. Then Supabase and Vercel per `docs/deployment-feasibility.md`.
