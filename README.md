# InvoiceMatch AI

Invoice ↔ purchase-order reconciliation as a small, honest proof of concept:

- **One Mastra agent** with two real, database-backed tools picks the purchase order when an invoice has no usable reference and proposes line correspondences.
- **A Mastra workflow** runs the process and **suspends for human approval** in Postgres. Any process can resume it later: the next request, a restarted server, a new deploy.
- **Deterministic, exact-decimal code** makes every money decision. The model never computes amounts and can never clear a finding.
- **Langfuse tracing** of the workflow, agent, model and tool spans, with token usage and cost per model call.

Synthetic, fictional data only. No payments, emails, OCR or ERP integration.

![Landing page](docs/screenshots/01-landing.png)

## Status (2026-10-27)

| Area | Status |
|---|---|
| Deterministic engine, workflow, agent + tools, Postgres persistence, owner auth, UI | Working locally and in production, tested |
| Offline evaluation | **16 / 16** labeled scenarios (mock model, see below) |
| Unit / integration tests | 49 / 49 · 30 / 30 |
| Live Claude calls | Live smoke **3 / 3** on `claude-haiku-5-5` (S12, S13, S16; [evaluation](docs/evaluation.md#3-live-llm-smoke-npm-run-evallive)). Production runs on Claude since 2026-10-21 |
| Agent benchmark | 36 labeled cases × 5 runs on Claude: PO accuracy **92.9 % → 100 %** (test split), **0 wrong picks**, cost per run −28 %, latency −34 %; Haiku 5.5 vs Sonnet 5.5 compared ([agent evaluation](docs/agent-evaluation.md)) |
| Langfuse Cloud delivery | Verified: full trace (workflow, agent, model, both tools) arrives in Langfuse Cloud EU, offline with the mock (`npm run check:langfuse`) and in production with Claude (generations with token usage and cost) |
| Public deployment | **https://invoicematch-ai-indol.vercel.app** (Vercel Hobby, `dub1`; Supabase Free eu-west-1). Public read-only samples; owner console behind Supabase magic link. Live Claude model, capped by the budget ledger ([gate](docs/deployment-feasibility.md)) |

**Which model runs where.** The deployed app's agent runs on **Claude (`claude-haiku-5-5`)**. Local development, CI, the offline evaluation and the 16 public precomputed samples use a **scripted mock language model** (`AGENT_MODE=mock`, the default), so they cost nothing and are reproducible. The mock is plugged into the real Mastra agent loop, so tool calls and persistence are real, but its "decisions" are a transparent heuristic, not an LLM. The UI labels it wherever it appears.

## Architecture

```mermaid
flowchart LR
  UI[Next.js pages] --> API[Route handlers<br/>auth · Zod · budget]
  API --> WF[Mastra workflow]
  WF --> AG[Mastra agent] --> M[Claude / mock model]
  AG --> T[[2 supplier-scoped tools]] --> DB[(Postgres app schema)]
  WF --> ENG[decimal.js rule engine]
  WF <--> SNAP[(Postgres mastra schema<br/>workflow snapshots)]
  AG -.-> LF[Langfuse]
```

`validate-input → persist-invoice-and-run → agent-lookup-mapping → deterministic-reconcile → review-gate (suspend) → persist-terminal-state`

Details: [docs/architecture.md](docs/architecture.md). Rounding policy, rule catalogue, status transitions and the durable-HITL sequence are all there.

## 60-second demo

1. **Landing page** (public): architecture, status table, 16 precomputed sample results. Open *Quantity mismatch*: the invoice and PO are side by side, the 5-vs-4 toner line is highlighted, and the finding cites `line 2 · quantity` ↔ `PO-1001-L2`, Δ 1, total Δ 108.78.
2. **Sign in** as owner → *Owner console* → run **PO selected by the agent**. The agent calls `lookupPurchaseOrders` then `getSupplierAndOrderDetails`, selects PO-3001, and maps both lines semantically. The rules therefore flag `PO_SELECTED_BY_AGENT` and `LINE_SEMANTIC_MAPPING`, and the run **suspends** at `review-gate`.
3. Stop the server, start it again, reload: the review is still pending, because the state lives in Postgres.
4. Write a reason and click **Approve exception**: the decision is stored, the workflow resumes, and the audit trail shows `DECISION_RECORDED → FINALIZED`. A second decision returns 409.

| Review required | Approved, with audit trail |
|---|---|
| ![](docs/screenshots/04-review-required.png) | ![](docs/screenshots/05-approved-audit-trail.png) |

These are real screenshots of a local production build (`scripts/screenshots.ts`), with the mock agent and synthetic data. In the deployed app the same flow runs on Claude.

## Tech stack

Next.js 16 (App Router, Node runtime) · TypeScript (strict) · Mastra (`@mastra/core`, `@mastra/pg`, `@mastra/observability`, `@mastra/langfuse`) · Anthropic via `@ai-sdk/anthropic` (default model `claude-haiku-5-5`) · PostgreSQL 17 (Docker locally; Supabase Free in production) · Supabase Auth (magic link) · Langfuse Cloud · Vercel Hobby · Zod 4 · decimal.js · Tailwind CSS 4 · Vitest · playwright-core (local screenshots only).

## Run it locally

Requirements: Node ≥ 22 (`.nvmrc` = 24), Docker.

```bash
npm ci
cp .env.example .env.local      # then fill the values below locally
npm run db:up                   # Docker Postgres on localhost:54329
npm run db:migrate && npm run db:seed
npm run dev                     # http://localhost:3000
```

`.env.local` minimum for the local demo (key names only here):

| Key | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://invoicematch:invoicematch@localhost:54329/invoicematch` for Docker |
| `AUTH_MODE` | `local` |
| `OWNER_EMAILS` | comma-separated owner allowlist |
| `OWNER_PASSPHRASE` | ≥ 12 characters |
| `SESSION_SECRET` | ≥ 32 random characters |
| `AGENT_MODE` | `mock` (default) or `anthropic` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LLM_BUDGET_USD`, `LLM_MAX_REQUESTS` | live mode only |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_PROJECT_URL` | optional tracing (`LANGFUSE_PROJECT_URL` = `https://cloud.langfuse.com/project/<id>`, without `/traces`) |

Demo credentials policy: there are no shared demo credentials. The owner sets their own passphrase locally; deployments must use Supabase Auth.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` · `typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | Unit tests (pure domain, schemas, mock heuristic) |
| `npm run test:integration` | Workflow, HITL across processes, failures, HTTP security, tracing. Each file uses its own scratch database |
| `npm run db:up` | Start Docker Postgres |
| `npm run db:migrate` · `db:seed` | Idempotent schema + Mastra storage init · fixtures |
| `npm run db:reset` | Drop and rebuild. **Refuses any non-local database URL** |
| `npm run eval:offline` | 16 scenarios → `evals/results/latest.json` and the public `data/samples/precomputed.json` |
| `npm run eval:live` | Opt-in live smoke (S12, S13, S16). Needs `ANTHROPIC_API_KEY` and `EVAL_LIVE_CONFIRM=yes` |
| `npm run eval:bench -- --label <name>` | Agent benchmark (36 cases; `--reps`, `--split`, `--model`, `--mock`). Live runs need `EVAL_LIVE_CONFIRM=yes`; global $3 cap over recorded runs. Scores go to Langfuse |
| `npm run eval:bench:langfuse -- <label>…` | Pulls a benchmark run's traces, generations, tools and scores back from the Langfuse Metrics API |
| `npm run check:secrets` | Fails on tracked env files or secret-looking strings |
| `npm run db:cloud` | Migrates and seeds the Supabase database (session pooler) and checks its schemas are not exposed to public roles |
| `npm run check:langfuse` | Runs one mock reconciliation on a scratch DB and confirms the full trace in Langfuse (needs Langfuse keys; no LLM spend) |
| `BASE_URL=… npx tsx scripts/screenshots.ts` | Browser smoke + real screenshots with local Chrome |

CI (`.github/workflows/ci.yml`) runs everything offline against a Postgres service, with no external secrets.

## Evaluation

[docs/evaluation.md](docs/evaluation.md): 16/16 offline (status + exact rule IDs), the critical-path test map, and the live-smoke protocol. The deterministic fixtures are **not** an LLM benchmark.

## Costs

- Infrastructure: €0. Vercel Hobby, Supabase Free and Langfuse Cloud free tiers, with no paid add-ons.
- Claude API: a reconciliation that needs the agent costs about $0.001 on `claude-haiku-5-5` (production S13: 3 model calls, $0.00088). Before each run the app reserves the worst-case cost in a Postgres ledger and refuses to call the model past the cap (production $5 / 400 requests lifetime; local default $3 / 30). The organization has no payment method, so promotional credits are the only funds.

## Restore / rebuild

Everything is rebuilt from tracked files: `migrations/`, `data/fixtures/`, `npm run db:migrate && npm run db:seed`. A paused or deleted Supabase Free project is restored from its dashboard or recreated and re-seeded. No keep-alive pings, by design. See [docs/deployment-feasibility.md](docs/deployment-feasibility.md).

## Known limitations

- The agent benchmark is synthetic (36 cases) and now saturated at 100 %. It shows the agent behaves correctly on the cases it was designed for; it is not an accuracy estimate for real invoices ([limits](docs/agent-evaluation.md#limits-of-this-study)).
- Supabase magic-link sign-in (PKCE over REST, no client SDK) verified end to end locally and in production against a real Supabase project; Supabase proves the email, then the app issues its own signed session.
- Purchase-order consumption across several invoices is not tracked; every invoice is compared with the full PO.
- Rate limiting is per process (best effort); the DB budget ledger is the hard guard for spend.
- Re-running a scenario stores a new invoice with the same number, which is flagged as a duplicate by design.

## Interview talking points

- **Agent vs workflow**: the workflow owns order, state and the human gate; the agent is one bounded step for interpretation only.
- **Tool calling**: two typed Zod tools; supplier scope is injected by the server via `requestContext`, so the model cannot widen it; candidate lists are capped at 5.
- **Human in the loop**: real `suspend()`; decision row first, then `resume()`; idempotency keys, unique constraints and conditional updates make double clicks, concurrent reviewers and crashes safe.
- **Evaluation-driven changes**: a labeled benchmark found that the PO search tool hid the right order when a supplier had more than five; paging plus line summaries fixed it and made runs 28 % cheaper. Sonnet was measured, not assumed better.
- **Observability**: one trace per run with workflow, step, agent, model and tool spans; trace id stored on the business record; verified offline and in Langfuse Cloud in production, including token usage and cost per Claude call.
- **Deterministic validation**: decimal.js, documented rounding, zero tolerance, every finding cites both sides and the exact delta; agent output can only add findings.
- **Postgres persistence**: business schema with constraints and append-only audit; Mastra snapshots in their own schema; everything rebuildable from migrations and seeds.

## Project files

`MASTER_PLAN.md` (contract) · `FINAL_REPORT.md` (handoff) · `docs/` · `.harness/invoicematch-ai/` (plan, checks and progress of the build run).
