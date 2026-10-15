# Deployment feasibility (MASTER_PLAN §5 gate)

Updated 2026-10-15 after local runtime tests. Documentation evidence is in `docs/feasibility.md`.

**Decision for this run: no deployment.** The owner chose local-only for the first session; Supabase, Vercel and Langfuse accounts were not connected. Status: `BLOCKED_USER_ACTION`. The application is not described as deployed anywhere.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | Next.js invokes the real Mastra agent/tools; env stays server-side | VERIFIED locally · PENDING TEST on Vercel | `next build` + `next start`: owner run through `/api/reconciliations` executed the agent and both tools (audit `AGENT_STEP`). Route handlers use `runtime = "nodejs"`; `serverExternalPackages: ["@mastra/*", "pg"]`. No secret reaches client bundles (no `NEXT_PUBLIC_` secrets). |
| 2 | Workflow state persisted in Postgres, not FS/memory | VERIFIED locally | Rows in `mastra.mastra_workflow_snapshot` with status `suspended`/`success` (`workflow.test.ts`). |
| 3 | start → suspend → request ends → restart/new invocation → resume | VERIFIED locally · PENDING TEST on Vercel | `restart.test.ts` (separate processes); manual: suspended under `next dev`, approved after killing it and starting `next start`. |
| 4 | No long worker, no sub-minute cron, suspension does not hold a function | VERIFIED by design + local measurement | Start and decision are separate short requests (mock run < 1 s; live run bounded by 4 model steps). Route `maxDuration = 60`. Hobby limit 300 s. |
| 5 | Supabase Free limits, pausing/restore, free slot | BLOCKED_USER_ACTION | Docs verified. Needs owner login and a new free project. `@mastra/pg` through the transaction pooler (port 6543) is PENDING TEST; fallback is the session pooler (5432). |
| 6 | Vercel Hobby terms (personal, non-commercial) and quotas | BLOCKED_USER_ACTION | Docs verified; owner must confirm non-commercial use and connect the account. |
| 7 | Authenticated live endpoints, spend guardrails, no anonymous billable calls | VERIFIED locally (app side) · BLOCKED_USER_ACTION (provider side) | `api-security.test.ts`; local auth refused when `VERCEL` is set, so production must use Supabase Auth. Console workspace spend limit must be set by the owner. |
| 8 | Langfuse free tier, retention, cardinality | BLOCKED_USER_ACTION | Instrumentation verified with `TestExporter`; spans per run ≈ 1 workflow + 6 steps + agent/model/tool spans only when the agent runs. Hobby: 50k units/month, 30-day access. |
| 9 | Cloud app + DB rebuildable from tracked migrations/seed/docs | VERIFIED locally · PENDING TEST on Supabase | `npm run db:reset` (local-guarded) and `db:migrate` + `db:seed` are idempotent; CI applies them on a fresh Postgres service. |

## Steps to deploy later (owner actions marked 👤)

1. 👤 Claude Console: claim subscriber credits, create a dedicated workspace with a low spend limit, create an API key there. Put it only in `.env.local` / Vercel env, never in chat.
2. 👤 Supabase: create a new free project `invoicematch-ai` (EU region). Do not reuse SpendInsight. Copy the **session pooler** connection string into `DATABASE_URL` (env only).
3. `npm run db:migrate && npm run db:seed` against that URL (never `db:reset`: it refuses non-local URLs).
4. 👤 Supabase Auth: enable email magic link; set `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OWNER_EMAILS`. The magic-link callback page is not built yet (see FINAL_REPORT "Not done").
5. 👤 Langfuse: EU project, keys into env; set `LANGFUSE_PROJECT_URL`.
6. 👤 Vercel: import the GitHub repo (Hobby), set env vars, deploy. Verify `/api/health`, anonymous 401s, owner run, suspend/resume across invocations, trace arrival.

## Supabase Free pausing

Free projects pause after about a week of inactivity and can be restored from the dashboard (the docs mention both 90 days and 1 year for the restore window; plan for 90). No keep-alive pings are used, by design. If a project is lost: create a new one and run `db:migrate` + `db:seed`; public sample pages keep working because they are static.
