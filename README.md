# InvoiceMatch AI

Invoice ↔ purchase-order reconciliation as a small, honest proof of concept:

- **One Mastra agent** with two real, database-backed tools picks the purchase order when an invoice has no usable reference and proposes line correspondences.
- **A Mastra workflow** runs the process and **suspends for human approval** in Postgres. Any process can resume it later: the next request, a restarted server, a new deploy.
- **Deterministic, exact-decimal code** makes every money decision. The model never computes amounts and can never clear a finding.
- **Langfuse-ready tracing** of the workflow, agent, model and tool spans.

Synthetic, fictional data only. No payments, emails, OCR or ERP integration.

![Landing page](docs/screenshots/01-landing.png)

## Status (2026-10-15)

| Area | Status |
|---|---|
| Deterministic engine, workflow, agent + tools, Postgres persistence, owner auth, UI | Working locally, tested |
| Offline evaluation | **16 / 16** labeled scenarios (mock model, see below) |
| Unit / integration tests | 34 / 34 · 29 / 29 |
| Live Claude calls | **Not run yet**: blocked on API credits (`BLOCKED_CREDITS`) |
| Langfuse Cloud delivery | Instrumentation verified offline; cloud delivery needs keys |
| Public deployment | **None.** Local only by owner decision ([gate](docs/deployment-feasibility.md)) |

The offline runs use a **scripted mock language model**. It is plugged into the real Mastra agent loop, so tool calls and persistence are real, but its "decisions" are a transparent heuristic, not an LLM. The UI labels it everywhere.

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

These are real screenshots of a local production build (`scripts/screenshots.ts`), with the mock agent and synthetic data.

## Tech stack

Next.js 16 (App Router, Node runtime) · TypeScript (strict) · Mastra (`@mastra/core`, `@mastra/pg`, `@mastra/observability`, `@mastra/langfuse`) · Anthropic via `@ai-sdk/anthropic` (default model `claude-haiku-5-5`) · PostgreSQL 17 (Docker locally; Supabase Free planned) · Zod 4 · decimal.js · Tailwind CSS 4 · Vitest · playwright-core (local screenshots only).

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
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_PROJECT_URL` | optional tracing |

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
| `npm run check:secrets` | Fails on tracked env files or secret-looking strings |
| `BASE_URL=… npx tsx scripts/screenshots.ts` | Browser smoke + real screenshots with local Chrome |

CI (`.github/workflows/ci.yml`) runs everything offline against a Postgres service, with no external secrets.

## Evaluation

[docs/evaluation.md](docs/evaluation.md): 16/16 offline (status + exact rule IDs), the critical-path test map, and the live-smoke protocol. The deterministic fixtures are **not** an LLM benchmark.

## Costs

- Infrastructure: €0. Only local Docker so far, and the planned services are free tiers with no paid add-ons.
- Claude API: 0 live requests made. When enabled, the app reserves the worst-case cost per run in a Postgres ledger before calling (default cap $3 / 30 requests). The Claude Console spend limit is the provider-side guard.

## Restore / rebuild

Everything is rebuilt from tracked files: `migrations/`, `data/fixtures/`, `npm run db:migrate && npm run db:seed`. A paused or deleted Supabase Free project is restored from its dashboard or recreated and re-seeded. No keep-alive pings, by design. See [docs/deployment-feasibility.md](docs/deployment-feasibility.md).

## Known limitations

- No live LLM evidence yet; agent quality with Claude is unmeasured.
- Supabase Auth adapter verifies tokens server-side, but the magic-link sign-in/callback UI is not built; deployments are blocked until it is.
- Purchase-order consumption across several invoices is not tracked; every invoice is compared with the full PO.
- Rate limiting is per process (best effort); the DB budget ledger is the hard guard for spend.
- Re-running a scenario stores a new invoice with the same number, which is flagged as a duplicate by design.

## Interview talking points

- **Agent vs workflow**: the workflow owns order, state and the human gate; the agent is one bounded step for interpretation only.
- **Tool calling**: two typed Zod tools; supplier scope is injected by the server via `requestContext`, so the model cannot widen it; candidate lists are capped at 5.
- **Human in the loop**: real `suspend()`; decision row first, then `resume()`; idempotency keys, unique constraints and conditional updates make double clicks, concurrent reviewers and crashes safe.
- **Observability**: one trace per run with workflow, step, agent, model and tool spans; trace id stored on the business record; verified offline, Langfuse when keys exist.
- **Deterministic validation**: decimal.js, documented rounding, zero tolerance, every finding cites both sides and the exact delta; agent output can only add findings.
- **Postgres persistence**: business schema with constraints and append-only audit; Mastra snapshots in their own schema; everything rebuildable from migrations and seeds.

## Project files

`MASTER_PLAN.md` (contract) · `FINAL_REPORT.md` (handoff) · `docs/` · `.harness/invoicematch-ai/` (plan, checks and progress of the build run).
