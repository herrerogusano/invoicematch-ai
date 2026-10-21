# Deployment feasibility (MASTER_PLAN §5 gate)

Updated 2026-10-15 after local runtime tests. Documentation evidence is in `docs/feasibility.md`.

**Status (2026-10-15 follow-up): deployed** to https://invoicematch-ai-indol.vercel.app with owner approval. Vercel Hobby project `invoicematch-ai`, functions in `dub1` next to Supabase eu-west-1, Node 24. It was deployed with the Vercel CLI from a clean `git archive` of the commit; the project has no Git integration, so pushes do not deploy. Deployment protection: the production domain is public, while deployment URLs and previews need Vercel login. Model: **live `claude-haiku-5-5`** since 2026-10-21 (`AGENT_MODE=anthropic`). The production budget ledger is capped at $5 / 400 model requests over the lifetime of the deployment. The key is workspace-scoped with a 30-day expiry, and the promotional credits are the only funds: the organization has no payment method. The first session was local-only by owner decision.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | Next.js invokes the real Mastra agent/tools; env stays server-side | VERIFIED locally and on Vercel (owner run of S13 in production: both tools, trace in Langfuse `production`) | `next build` + `next start`: owner run through `/api/reconciliations` executed the agent and both tools (audit `AGENT_STEP`). Route handlers use `runtime = "nodejs"`; `serverExternalPackages: ["@mastra/*", "pg"]`. No secret reaches client bundles (no `NEXT_PUBLIC_` secrets). |
| 2 | Workflow state persisted in Postgres, not FS/memory | VERIFIED locally | Rows in `mastra.mastra_workflow_snapshot` with status `suspended`/`success` (`workflow.test.ts`). |
| 3 | start → suspend → request ends → restart/new invocation → resume | VERIFIED locally and on Vercel (S13 suspended by one function invocation, approved by a later one: `APPROVED_WITH_EXCEPTION`, decision `RESUMED`) | `restart.test.ts` (separate processes); manual: suspended under `next dev`, approved after killing it and starting `next start`. |
| 4 | No long worker, no sub-minute cron, suspension does not hold a function | VERIFIED by design + local measurement | Start and decision are separate short requests (mock run < 1 s; live run bounded by 4 model steps). Route `maxDuration = 60`. Hobby limit 300 s. |
| 5 | Supabase Free limits, pausing/restore, free slot | VERIFIED (session pooler) · PENDING TEST (transaction pooler) | Project `invoicematch-ai` (Free, eu-west-1, Postgres 17.11). `npm run db:cloud`: migrations, Mastra storage and seed applied, idempotent on re-run. Cross-process suspend → approve → second decision refused, all through the session pooler (5432). Timings from Spain: 45 ms round trip, S01 2.8 s, S13 (agent + tools) 4.7 s. `@mastra/pg` through the transaction pooler (6543) is still PENDING TEST. |
| 6 | Vercel Hobby terms (personal, non-commercial) and quotas | VERIFIED | Personal, non-commercial portfolio demo on the owner's Hobby account. |
| 7 | Authenticated live endpoints, spend guardrails, no anonymous billable calls | VERIFIED locally and in production (anonymous POST/GET → 401, cross-origin → 403, passphrase login → 404) · Console spend limit pending (no Claude key yet) | `api-security.test.ts`; local auth refused when `VERCEL` is set, so production must use Supabase Auth. Console workspace spend limit must be set by the owner. |
| 8 | Langfuse free tier, retention, cardinality | VERIFIED (delivery, Hobby EU project) | `npm run check:langfuse`: full trace arrives (22 observations per agent run with the mock model). Instrumentation also verified with `TestExporter`; spans per run ≈ 1 workflow + 6 steps + agent/model/tool spans only when the agent runs. Hobby: 50k units/month, 30-day access. |
| 9 | Cloud app + DB rebuildable from tracked migrations/seed/docs | VERIFIED locally and on Supabase | `npm run db:reset` (local-guarded) and `db:migrate` + `db:seed` are idempotent; CI applies them on a fresh Postgres service. |

## Steps to deploy later (owner actions marked 👤)

1. 👤 Claude Console: claim subscriber credits, create a dedicated workspace with a low spend limit, create an API key there. Put it only in `.env.local` / Vercel env, never in chat.
2. ✅ Supabase project `invoicematch-ai` (Free, eu-west-1) created 2026-10-15. Locally, `.env.local` holds `SUPABASE_DATABASE_URL` (session pooler, no password) and `SUPABASE_DB_PASSWORD`.
3. ✅ `npm run db:cloud` applies migrations, Mastra storage and seed, then fails if the `app`/`mastra` schemas are reachable by Supabase's `anon`/`authenticated` roles (verified: not exposed through the Data API, no grants). Never `db:reset` against the cloud (it refuses non-local URLs).
4. ✅ Supabase Auth magic link built and verified locally on 2026-10-15 (project `invoicematch-ai`, eu-west-1). For Vercel: add `https://<vercel-domain>/auth/callback` to Auth → Redirect URLs, set Site URL, and set `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key), `OWNER_EMAILS`, `SESSION_SECRET`. The built-in email sender allows 2 emails/hour.
5. ✅ Langfuse: EU project created and keys in `.env.local` (2026-10-15); for Vercel, copy the same keys into the project env.
6. ✅ Vercel: project and 14 production env vars created through the API, then `vercel deploy --prod` from a clean archive. Verified: `/api/health` (DB ok), anonymous 401s, owner magic link, owner run, suspend/resume across invocations, Langfuse trace (environment `production`). Redeploy: same procedure with a short-lived Vercel token; Supabase Redirect URLs must include `<domain>/auth/callback`.

## Supabase Free pausing

Free projects pause after about a week of inactivity and can be restored from the dashboard (the docs mention both 90 days and 1 year for the restore window; plan for 90). No keep-alive pings are used, by design. If a project is lost: create a new one and run `db:migrate` + `db:seed`; public sample pages keep working because they are static.
