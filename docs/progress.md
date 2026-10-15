# Progress checkpoints

Times are Europe/Madrid, 2026-10-15. Detailed checks: `.harness/invoicematch-ai/checks.md`.

| Time | Stage | Checkpoint |
|---|---|---|
| 11:20 | 0 | Discovery: empty folder, Node 24, npm 11, Docker running, `gh` authenticated; no Supabase/Vercel CLI, no keys. Bootstrap decisions agreed (`docs/bootstrap-decisions.md`). |
| 11:25 | 0 | Documentation research → `docs/feasibility.md`. |
| 11:30 | 1 | Skeleton: Next.js 16, strict TS, ESLint, Prettier, Vitest; lint/typecheck/build green. |
| 11:40 | 2–3 | Schema, seed, decimal engine, Mastra agent + tools, mock model, workflow. Offline eval 16/16 on first run. Commit `af656f7`. |
| 11:50 | 3 | Critical-path integration tests incl. cross-process resume and tracing. Commit `c3fc12f`. |
| 12:05 | 4 | Auth, API routes, UI; HTTP security tests. Commit `05f76b2`. |
| 12:20 | 4 | Real HTTP flow across a server restart; real screenshots via local Chrome. Commit `5ac4564`. |
| 12:30 | 5–7 | Secret scan, opt-in live eval (refuses without key), CI workflow, docs, README. |

| 14:35 | 5 | Langfuse Cloud EU keys added by the owner; `npm run check:langfuse` PASS (full trace via v2 observations API). |

Blocked (owner action needed): Claude API credits, Supabase project, Vercel deployment.
