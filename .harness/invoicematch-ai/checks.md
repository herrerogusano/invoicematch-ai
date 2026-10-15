# Checks: InvoiceMatch AI harness run (2026-10-15)

Verdict: `pass`, `fail` or `unresolved`. Evidence is a command or test that was actually run in this session. Model confidence is not evidence.

| step | requirement | verdict | evidence |
|---|---|---|---|
| 0 | Current docs for Mastra, Langfuse, Supabase, Vercel, Anthropic checked and labeled | pass | `docs/feasibility.md` (research agent fetched the official pages; 2 moved URLs noted) |
| 1 | install, lint, typecheck, build green on the skeleton | pass | `npm run lint`, `tsc --noEmit`, `next build` before stage 2 |
| 1 | `npm ci` from the lockfile | pass | final local verification 12:30 and CI run 38720997620 |
| 2 | SQL migrations with constraints, FKs, indexes; replayable | pass | `db:migrate` applied `0001`; second run "migrations up to date"; CI applies them on fresh Postgres |
| 2 | Seed idempotent | pass | `db:seed` twice → 4 suppliers, 7 POs, 16 PO lines, 1 historical invoice (psql count) |
| 2 | `db:reset` refuses non-local URLs | pass | guard `isLocalDatabaseUrl` + `NODE_ENV=production` check in `scripts/reset.ts`; used locally only |
| 2 | Exact decimal money, documented rounding, zero tolerance | pass | `tests/unit/money.test.ts`, `reconcile.test.ts` (34/34) |
| 2 | Boundary, duplicate, missing PO, supplier, currency, tax, missing/extra line, valid match | pass | `reconcile.test.ts`, scenarios S01–S16 |
| 3 | Real Mastra agent with 2 DB-backed Zod tools, bounded and supplier-scoped | pass | `workflow.test.ts` "agent tools are bounded and supplier-scoped"; eval tool calls listed per scenario |
| 3 | Mock adapter never presented as LLM evidence | pass | `[MOCK]` reasons, UI badge "MOCK MODEL (offline stand-in, not an LLM)", eval disclaimer |
| 3 | Durable suspend/resume in Postgres | pass | `mastra.mastra_workflow_snapshot` status `suspended` → `success` (`workflow.test.ts`) |
| 3 | Resume from a separate process | pass | `restart.test.ts`: 5 distinct PIDs, approve + reject |
| 3 | Duplicate/concurrency guards, double-resume safety | pass | idempotent start (sequential + 3 concurrent), 5 concurrent decisions → 1 winner, replay, crash recovery |
| 4 | Server-side auth on every mutation; anonymous → 401/403, zero LLM calls | pass | `api-security.test.ts` (counting model = 0) |
| 4 | Explicit status codes and structured errors | pass | 400/401/403/404/409/413/415/429 paths; tests cover 400, 401, 403, 404, 409, 415 |
| 4 | UI: public read-only samples, owner run, review, audit after reload, mobile | pass | `scripts/screenshots.ts` against `next start` (6 real screenshots in `docs/screenshots/`) |
| 4 | Pending review survives a server restart | pass | manual: suspended under `next dev`, killed (PID 86104), approved under `next start`; second decision 409 |
| 5 | Tracing spans for workflow, agent, model, each tool; correlation; no secrets | pass | `tracing.test.ts` with Mastra `TestExporter` |
| 5 | Langfuse Cloud trace arrival | pass | 2026-10-15 follow-up: `npm run check:langfuse` → 22 observations incl. agent, 2 generations, both tools (mock model) |
| 5 | ≥12 labeled scenarios, scored N/N with failed IDs | pass | `npm run eval:offline` → 16 / 16, `evals/results/latest.json` |
| 5 | Small live LLM smoke with cost accounting | unresolved | BLOCKED_CREDITS: no API key; `eval:live` refuses without key (verified) |
| 6 | Deployment gate run, deploy if feasible and approved | unresolved | Not approved this session (local-only); gate table in `docs/deployment-feasibility.md` |
| 7 | Secret scan, no tracked env files | pass | `npm run check:secrets` |
| 7 | CI offline with Postgres service, no secrets | pass | GitHub Actions run 38720997620 on `feature/mvp`: all 13 steps green (Linux) |
| 7 | Final local sequence: npm ci → secrets → lint → typecheck → unit → migrate/seed → integration → eval → build | pass | run at 12:30: 34/34, 29/29, 16/16, build OK |
| 7 | Integration suite stability on Windows | unresolved | 1 of ~6 runs of `api-security.test.ts` ended with native worker exit 0xC0000409 before assertions; all later runs passed |
| 4 | Supabase magic-link owner sign-in (follow-up) | pass | unit `supabase-auth.test.ts` 8/8 (PKCE, allowlist, no owner oracle, origin, rate limit, session bound to mode); real run 2026-10-15 under `next dev`: `POST /api/auth/magic-link` 200 → email → `GET /auth/callback` 307 → `/owner` 200 |
