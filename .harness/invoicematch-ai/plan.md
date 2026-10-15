# InvoiceMatch AI — Harness Run plan

## Context
The user wants the project in `~/Downloads/MASTER_PLAN.md` built: **InvoiceMatch AI**. It is a portfolio PoC built with Next.js, a Mastra agent and a Mastra workflow (durable suspend/resume HITL), Postgres, Langfuse, and deterministic money validation. The working folder `Personal Projects\Nueva carpeta` is empty and must be renamed to `invoicematch-ai`. It is a personal project with no vault note yet.

**Bootstrap decisions (MASTER_PLAN §3B), answered 2026-10-15:**
| Item | Decision | Status |
|---|---|---|
| Git | Local repo with commits per stage. Create **private** GitHub repo `herrerogusano/invoicematch-ai` via `gh` (already authenticated) and push a feature branch. Never force-push. | APPROVED |
| Claude API | Credits are not available yet (expected from 2026-10-16). Build with the mock agent adapter; live smoke → `BLOCKED_CREDITS`. Budget for later: $3 / 30 requests by default, to be confirmed when credits are available. | BLOCKED_CREDITS |
| Supabase / Langfuse / Vercel | Local only for now: Docker Postgres, no-op Langfuse exporter (instrumentation stays), no deploy. Provider setup is documented. | BLOCKED_USER_ACTION |
| Owner auth | Auth interface with a Supabase Auth adapter (wired, unverified) plus a local adapter: HMAC-signed session cookie from `OWNER_PASSPHRASE` and an owner email allowlist. The local adapter **refuses to run when `NODE_ENV=production`** unless Supabase is configured. | APPROVED (local) |
| Harness files | `.harness/invoicematch-ai/{plan,checks,progress}.md`, committed with the project | APPROVED |

Approving this plan counts as `GO AUTONOMOUS` for local work. Cloud, live LLM and deploy steps stay blocked until a later session.

**Estimate:** about 35–45 human hours (senior dev): research 3, skeleton 3, DB plus engine 8, Mastra 8, API/UI 8, evals/tracing 4, hardening/docs 5. Model sessions will be shorter. Actual time will be logged at close.

## Steps (sequential unless marked ∥)
0. **Research (∥ Explore/general agent, read-only web):** check current Mastra (agent, tools, workflow `suspend/resume`, `@mastra/pg` PostgresStore, Next.js integration, Langfuse exporter), AI SDK Anthropic provider, Supabase Free, Vercel Hobby, and Anthropic credits. Output: `docs/feasibility.md` with URLs, dates and VERIFIED / PENDING TEST / NOT VIABLE labels. *Check:* every §10 reference has been visited and labeled.
1. **Skeleton:** `git init`. Next.js App Router, strict TS, npm, ESLint, Prettier, Vitest, `.nvmrc`, `.gitignore`, `.env.example` (key names only), and `docs/{architecture,bootstrap-decisions,progress}.md`. Copy `MASTER_PLAN.md` into the repo. *Check:* `npm ci && npm run lint && npm run typecheck && npm run build` all green.
2. **DB plus deterministic engine:** `docker-compose.yml` with Postgres. Explicit SQL migrations for supplier, PO, PO line, invoice, invoice line, reconciliation, review_decision, budget ledger, with FKs, uniques and indexes. Mastra tables go in a separate schema. Scripts: `db:migrate`, `db:seed`, `db:reset` (with a guard that refuses non-local URLs). `src/domain/reconcile.ts`: decimal.js, minor units, rule IDs, `ruleFindings[]`, status transition table. 12+ fictional fixtures in `data/fixtures`. *Check:* unit tests for every rule and boundary case; migrate, seed and re-seed are idempotent against Docker.
3. **Mastra:** `reconciliationAgent` with two Zod tools (`lookupPurchaseOrders` bounded and supplier-scoped, `getSupplierAndOrderDetails`) and Zod structured output with ID validation against the DB. Mock adapter plus live Anthropic adapter (model ID read from env; the live adapter is not called). Named workflow: validate → persist → agent → reconcile → review gate (`suspend()`) → persist terminal state. PostgresStore, idempotency keys, guard against double resume. *Check:* integration test that suspends in process A, then resumes approve and reject from a separate process B against the same DB. Also test duplicate submission, concurrent approvals (one wins), and a simulated model outage → `FAILED` with an explicit state.
4. **API plus UI:** route handlers with Zod validation and error codes: cases, start run, reconciliations, pending reviews, decide, health. Owner guard checked server-side on every mutation, plus the budget ledger. Pages: landing/architecture, precomputed public read-only results, side-by-side line diff with findings, owner run page, review queue with audit trail. Mobile-readable. *Check:* security tests where an anonymous POST to run/decide returns 401/403 and makes zero agent calls. Build is green. Manual browser smoke via preview.
5. **Tracing plus evals:** Langfuse exporter wired as a no-op without keys, with sanitized metadata. `eval:offline` writes `evals/results/latest.json` and `docs/evaluation.md` (N/N, failed IDs). `eval:live` is an opt-in script with a hard cap and refuses to run without a key. *Check:* offline eval 12/12 with mock clearly labeled as mock. Live is marked BLOCKED_CREDITS.
6. **Deploy:** not done this session. Write `docs/deployment-feasibility.md` with the gate list and the exact remaining user actions. Status BLOCKED_USER_ACTION.
7. **Hardening plus Git:** `npm ci`, lint, typecheck, test, integration, build, eval, and a secret scan (grep plus `git diff --check`). GitHub Actions CI (offline, Postgres service, no secrets). README (Mermaid diagram, demo, talking points). `FINAL_REPORT.md`. Create the private repo and push `feature/mvp`. *Check:* all green, `git status` clean, no `.env*` tracked.
8. **Close:** create the vault note, STATUS, `InvoiceMatch AI - Decisiones.md` and a Project Registry row. Add the first-use log entry to Harness Run. Run the Git state check. **Rename the folder** `Nueva carpeta` → `invoicematch-ai` as the very last action, because Windows locks the session's working directory. If it is still locked, tell the user to rename it after closing the session and update the registry path accordingly.

## Harness rules
- Subagents get only their step, its inputs and its check. No two agents edit the same file. Steps 2 and 3 are mostly sequential; research (0) runs in parallel with the skeleton (1).
- Max 3 fix attempts per failing step, then `unresolved`. Never weaken a check.
- Proposed hook (needs separate approval via update-config): a PreToolUse guard that blocks `git add` of `.env*` files. Not installed by default.

## Verification (end to end)
`docker compose up -d && npm ci && npm run db:reset && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run eval:offline && npm run build`, then `npm run dev`. In the browser: view public results, log in as owner, run the mock reconciliation, see the pending review, restart the server, approve or reject, and confirm the audit trail persists. Evidence for each check goes to `.harness/invoicematch-ai/checks.md`.
