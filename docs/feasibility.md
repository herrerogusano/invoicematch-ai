# Feasibility notes: InvoiceMatch AI

These are read-only checks of current official documentation, done on 2026-10-15 before implementation. MASTER_PLAN §10 lists the starting references.

Status labels:
- **VERIFIED**: confirmed in an official doc fetched today.
- **PENDING TEST**: documented, but this project still needs to prove it at runtime.
- **NOT VIABLE**: the docs show it cannot work.

Docs are evidence, not proof. Every integration still needs a runtime test in this repo. No free tier listed here guarantees uptime.

---

## 1. Mastra + Next.js integration

**Status: VERIFIED (docs) / PENDING TEST (runtime)**

- Install the Mastra workspace with `npx mastra@latest init`, which creates `src/mastra/index.ts`, `agents/` and `tools/`. Node.js >= 22.13.0 is required.
- Route handlers import the `mastra` instance and call agents or workflows server-side, for example `mastra.getAgentById(...)` or `mastra.getWorkflow(...)`.
- Optional full HTTP API: `createNextRouteHandler({ mastra, prefix })` from `@mastra/next`, which needs the `hono` peer dependency. `prefix` defaults to `/api` and must match the catch-all mount path. This project does not need it. Explicit route handlers give tighter auth control.
- **next.config requirement:** `serverExternalPackages: ['@mastra/*']` in `next.config.ts`. It is stated on the Mastra web-framework deployment page, not on the current Next.js integration page.
- Do not use LibSQLStore with a local `file:` or in-memory DB on serverless, because it needs filesystem access. Use PostgresStore (§3).
- Sources (accessed 2026-10-15):
  - https://mastra.ai/integrations/frameworks/next-js (fetched; it does not mention `serverExternalPackages`)
  - https://mastra.ai/docs/deployment/web-framework.md (the `serverExternalPackages` requirement and the LibSQL warning)
  - https://mastra.ai/reference/server/next-adapter.md

## 2. Mastra workflows: createWorkflow/createStep, suspend/resume, snapshots

**Status: VERIFIED (docs) / PENDING TEST (cross-process resume against Postgres)**

- `createStep({ id, inputSchema, outputSchema, resumeSchema, suspendSchema, execute })`. `execute` receives `{ inputData, resumeData, suspend, suspendData, ... }`.
- `return await suspend(payload)` pauses the step and sets the run status to `suspended`. `suspendSchema` validates the payload, and `suspendData` exposes it again on resume. `resumeSchema` types `resumeData`.
- `const run = await workflow.createRun({ runId?, resourceId?, disableScorers? })` is async.
- `await run.start({ inputData })` returns a result. `result.status === 'suspended'` confirms the suspension, and `result.suspended` lists the suspended step paths.
- `run.resume({ step?, resumeData, requestContext?, forEachIndex?, tracingOptions?, outputOptions? })`:
  - `step` can be a Step object, a step-id string, or an array of either.
  - `step` may be omitted when exactly one step is suspended.
- **Resume from a different process or request:** `const run = await workflow.createRun({ runId }); await run.resume({ step: 'step-id', resumeData })`.
- Stored state is available through `workflow.getWorkflowRunById(runId)`. `createWorkflowStateReader(state)`, from `@mastra/core/workflows`, gives `getSuspendedStep()`.
- If two resumes race, the losing call throws an error whose `error.id === 'WORKFLOW_RESUME_ALREADY_CLAIMED'`. Handle this as idempotency for the approve endpoint.
- Snapshots are saved to the storage configured on the `Mastra` instance:
  - Table: `workflow_snapshots`, keyed by `runId` and workflow name.
  - Saved on `suspend()` through `persistWorkflowSnapshot()`; loaded on resume through `loadWorkflowSnapshot()`.
  - Suspended runs survive restarts and redeploys only when storage is configured.
- Implication for gate items 3 and 4: the suspension does not hold an HTTP function open. Each start or resume is a separate short request, which fits the serverless model (still PENDING TEST).
- The URL in MASTER_PLAN, https://mastra.ai/en/reference/workflows/snapshots, returned **HTTP 404**. The content now lives at https://mastra.ai/docs/workflows/snapshots.md.
- Sources (accessed 2026-10-15):
  - https://mastra.ai/docs/workflows/suspend-and-resume.md
  - https://mastra.ai/reference/workflows/run-methods/resume.md
  - https://mastra.ai/reference/workflows/workflow-methods/create-run.md
  - https://mastra.ai/docs/workflows/snapshots.md

## 3. Mastra PostgresStore (@mastra/pg)

**Status: VERIFIED (docs) / PENDING TEST**

- Import: `import { PostgresStore } from '@mastra/pg'`.
- Options:
  - `id`: required identifier.
  - `connectionString`, or `host`/`port`/`database`/`user`/`password`, or an existing `pool` (`pg.Pool`, which Mastra will not close).
  - `schemaName`: default `'public'`.
  - `ssl`: `boolean | ConnectionOptions`.
  - `max`: pool size, default 20.
  - `idleTimeoutMillis`: default 30000.
  - `disableInit`, `skipDefaultIndexes`, `indexes`.
- Init behaviour:
  - When passed to `new Mastra({ storage })`, Mastra calls `init()` automatically, which creates the tables and runs Mastra's own migrations.
  - Standalone use needs `await storage.init()`.
  - `disableInit: true` skips table creation, so you must run migrations separately.
- Project decision to test: use a dedicated `schemaName` (for example `mastra`) so Mastra tables stay apart from app tables. On serverless with the Supabase pooler, set `max` to 1 (see §6).
- Source (accessed 2026-10-15): https://mastra.ai/integrations/databases/postgresql.md. There is no dedicated PostgresStore reference page in llms.txt.

## 4. Langfuse + Mastra tracing

**Status: VERIFIED (docs) / PENDING TEST (no Langfuse keys in this session)**

- Packages: `@mastra/observability` and `@mastra/langfuse`.
- Config:
  ```ts
  import { Observability } from '@mastra/observability'
  import { LangfuseExporter } from '@mastra/langfuse'
  new Mastra({ observability: new Observability({ configs: { langfuse: {
    serviceName: 'invoicematch-ai',
    exporters: [new LangfuseExporter({ publicKey, secretKey, baseUrl, environment, release })],
  } } }) })
  ```
- Exporter options:
  - `publicKey`, `secretKey`, `baseUrl`, `additionalHeaders`
  - `realtime`: default false (batch)
  - `flushAt`, `flushInterval`, `environment`, `release`, `logger`, `logLevel`
- Zero-config `new LangfuseExporter()` reads `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`.
- **Without keys:** the Mastra reference says the exporter is disabled and its `client` getter returns `undefined`. It does not say whether a warning is logged. A no-op local run still needs PENDING TEST.
- **Serverless:** `await exporter.flush()` forces export of buffered spans before the runtime terminates. `shutdown()` flushes, then closes. Test this on Vercel, or use `realtime: true` for the demo.
- EU base URL: `https://cloud.langfuse.com` (EU, and also the default). US is `https://us.cloud.langfuse.com`.
- Sources (accessed 2026-10-15):
  - https://langfuse.com/integrations/frameworks/mastra
  - https://mastra.ai/integrations/observability/langfuse.md
  - https://mastra.ai/reference/observability/tracing/exporters/langfuse.md
  - https://langfuse.com/docs/observability/get-started

## 5. Langfuse pricing (Hobby)

**Status: VERIFIED**

- **Free-tier quotas:**
  - USD 0, no credit card required.
  - 50k units per month, 30 days of data access, 2 users.
  - 1 annotation queue, 2 alerts.
  - Ingestion limited to 1,000 req/min; General API to 30 req/min.
  - Community (GitHub) support only.
- **Paid-overage semantics:** Hobby has no overage pricing (listed as "--"). The page does not say whether ingestion is blocked or dropped over 50k units. Treat it as unknown and keep trace cardinality low. Paid plans include 100k units, then USD 8 per 100k, with graduated rates.
- **Inactivity:** nothing is documented on the pricing page.
- **Availability:** no uptime guarantee is claimed for Hobby.
- Source (accessed 2026-10-15): https://langfuse.com/pricing

## 6. Supabase Free

**Status: VERIFIED (docs) / BLOCKED_USER_ACTION (no account/project in this session)**

- **Free-tier quotas:**
  - 2 active projects.
  - 500 MB database per project.
  - 5 GB egress plus 5 GB cached egress.
  - 50,000 MAU, 1 GB file storage, 500,000 Edge Function invocations.
  - No automatic backups.
  - Pro starts at USD 25 per month.
- **Inactivity:**
  - Free projects with low activity over a 7-day period may be paused. "A few user requests to the database each day" over the previous week is typically enough to avoid this.
  - MASTER_PLAN forbids cron pings to keep the project awake.
- **Restore:**
  - Dashboard: Organization, then the paused project, then **Resume project**. Data and config return.
  - The page body says restore is possible within a **1-year window**, but a heading on the same page mentions 90 days. This is inconsistent; plan for the shorter window.
  - Backups are kept "for a limited period", with no exact number given.
- **Paid-overage semantics:** the pricing page describes overage and spend caps only for paid plans. Free-plan behaviour when a quota is exceeded is not stated there.
- **Availability:** no uptime guarantee; projects can be paused. The DB must be rebuildable from tracked migrations and seed data (gate item 9).
- **Serverless connection guidance:**
  - Use the shared pooler in **transaction mode, port 6543**. Host is `aws-[INDEX]-[REGION].pooler.supabase.com`, copied from the Connect dialog. User is `postgres.[PROJECT-REF]`.
  - The pooler is IPv4. Direct connections are IPv6 unless the IPv4 add-on is purchased.
  - Transaction mode does not support prepared statements, session state, LISTEN/NOTIFY, temp tables or pipelining.
  - Create the client once at module scope, use a pool size of 1, and set `sslmode=require`.
  - **PENDING TEST:** whether `@mastra/pg` (node-postgres) works through transaction-mode pooling. The risk is prepared statements or session state.
- Sources (accessed 2026-10-15):
  - https://supabase.com/pricing
  - https://supabase.com/docs/guides/platform/free-project-pausing
  - https://supabase.com/docs/guides/database/connecting-to-postgres

## 7. Vercel Hobby

**Status: VERIFIED (docs) / BLOCKED_USER_ACTION (no account in this session)**

- **Terms:** Hobby is restricted to "non-commercial, personal use only", per the fair use guidelines. A personal portfolio PoC fits; the user must confirm there is no commercial use.
- **Free-tier quotas:**
  - 1,000,000 function invocations, 4 CPU-hours of Active CPU, 360 GB-hours of provisioned memory.
  - 100 GB Fast Data Transfer, 1,000,000 CDN requests.
  - 100 deployments per day, 1 hour of runtime logs.
- **Function limits (Fluid compute):**
  - Max duration on Hobby is **300 s default and maximum**.
  - Memory is 2 GB / 1 vCPU.
  - Request and response bodies are capped at 4.5 MB.
  - 250 MB uncompressed bundle.
  - 1,024 file descriptors, shared across concurrent executions.
  - A timeout returns 504 `FUNCTION_INVOCATION_TIMEOUT`.
- **Paid-overage semantics:** Hobby has no overage billing. If usage limits are exceeded, "in most cases" you must wait 30 days to use the feature again. Spend Management is not available on Hobby.
- **Inactivity:** none documented.
- **Availability:** no uptime guarantee is claimed.
- Implication: the agent step and each workflow start or resume must finish well under 300 s. Waiting for human approval happens between requests, never inside one.
- Sources (accessed 2026-10-15):
  - https://vercel.com/docs/plans/hobby (page last_updated 2026-09-14)
  - https://vercel.com/docs/functions/limitations (page last_updated 2026-08-24)

## 8. Anthropic API: subscriber credits, rate/spend limits, model

**Status: VERIFIED (docs) / BLOCKED_CREDITS until credits are claimed (~2026-10-16)**

- **Subscriber credits:**
  - Max 5x gets USD 100 a month and Max 20x gets USD 200 a month. Team gets USD 20 per Standard seat and USD 100 per Premium seat, pooled and capped at USD 500. Free, Pro and Enterprise are not eligible.
  - New subscribers can claim after 7 days on an eligible plan.
  - To claim, link a Console org in claude.ai, under Settings, then Billing, then API credits.
  - Credits cover the Claude API, Managed Agents, the Agent SDK and the playground. They do **not** cover Claude Code.
  - Credits expire at the end of each billing cycle with no rollover. No payment method is needed.
  - When credits run out and there is no purchased balance, API requests **stop**. The error is "Your credit balance is too low...". Usage is never charged to the Claude plan.
- **Spend limits:**
  - Tier caps: Start USD 500/month, Build USD 1,000, Scale USD 200,000.
  - A user-set limit goes in Console under Billing, then Spend limits; exceeding it returns HTTP 400 `invalid_request_error`.
  - Per-workspace spend and rate limits are available, but not on the default workspace.
  - **Recommended:** a dedicated workspace with a low spend limit for this project.
- **Rate limits:**
  - Start tier for Claude Haiku 5.5: 1,000 RPM, 2,000,000 ITPM, 400,000 OTPM.
  - New orgs may start in a lower "Evaluation" tier.
  - Exceeding a limit returns 429 `rate_limit_error`, with a `retry-after` header when present.
  - The spend-cap 429 has no `retry-after`, so do not retry it.
- **Cheapest current model with tool use:** **Claude Haiku 5.5**, API ID **`claude-haiku-5-5`** (the alias is the same pinned ID). It costs from USD 0.10 per input MTok and from USD 0.50 per output MTok. The overview says all current models support tool use.
- Sources (accessed 2026-10-15):
  - https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
  - https://platform.claude.com/docs/en/api/rate-limits (https://docs.anthropic.com/en/api/rate-limits redirects here with 301)
  - https://platform.claude.com/docs/en/about-claude/models/overview

---

## Deployment gate (MASTER_PLAN §5)

This session is local-only. There are no cloud accounts, and no API credits until about 2026-10-16.

| # | Gate item | Status | Evidence / next step |
|---|-----------|--------|----------------------|
| 1 | Deployed Next.js invokes real Mastra agent/tools; env vars stay server-side | PENDING TEST | Docs: `serverExternalPackages: ['@mastra/*']` plus route handlers. Test locally first, then on Vercel once the account exists. |
| 2 | Persisted workflow state uses Postgres, not FS/memory | PENDING TEST | `PostgresStore` → `workflow_snapshots` table. Verify rows in Docker Postgres. |
| 3 | start → suspend → end request → restart/another invocation → resume works | PENDING TEST | `createRun({ runId })` + `run.resume({ step, resumeData })`. Local test: kill the process between suspend and resume. |
| 4 | No long-running worker, sub-minute cron or long request; suspension does not hold a function | PENDING TEST | The design is two short requests. Hobby max duration is 300 s. Measure request durations. |
| 5 | Supabase Free limits, pausing/restore, free slot available | BLOCKED_USER_ACTION | Docs verified (§6). The user must create or confirm a free project slot. Transaction-pooler compatibility with `@mastra/pg` is PENDING TEST. |
| 6 | Vercel Hobby personal/non-commercial terms fit; quotas sufficient | BLOCKED_USER_ACTION | Docs verified (§7). The user must confirm non-commercial use and connect an account. |
| 7 | Authenticated live endpoints and spend guardrails; no anonymous billable endpoints | PENDING TEST | Implement owner auth plus a dedicated Anthropic workspace spend limit (Console; BLOCKED_USER_ACTION). |
| 8 | Langfuse free-tier compatibility, retention, cardinality | PENDING TEST / BLOCKED_USER_ACTION | Hobby: 50k units/month, 30 days access (§5). Over-quota behaviour is undocumented. Keys are needed for the end-to-end trace test. |
| 9 | Cloud app and restored DB rebuildable from tracked migrations, seed and docs | PENDING TEST | Requires `db:reset` plus documented steps. Validate against Docker Postgres, then Supabase. |
