# INVOICEMATCH AI — MASTER IMPLEMENTATION PLAN

**Version:** 1.0  
**Prepared:** 2026-10-15  
**Owner:** user  
**Implementation operator:** Claude Code using the user's Claude Max 5x subscription  
**Project type:** Small, interview-ready, portfolio-grade proof of concept  
**Execution contract:** One interactive bootstrap phase followed by autonomous implementation, verification, feasible deployment and Git handoff. Read this document in full before executing any step.

---

## 0. EXECUTIVE INSTRUCTION FOR CLAUDE CODE

You are the technical lead and implementer of InvoiceMatch AI. **Carry the project from beginning to end** within this plan. Your first task is NOT writing code: inspect the local environment/repository, independently validate current documentation and costs, then conduct **one concentrated, interactive setup session** with the user to close remaining *account-specific* questions, request access and obtain the permissions necessary for unattended work. The user will then explicitly say **`GO AUTONOMOUS`**. Only after that instruction, work without further interaction, from scaffolding to reproducible tests, deployed demo if feasible/authorized, final Git check and a precise handoff report.

**Never assume that this file itself grants permission to spend money, expose private data, delete resources, change account settings or push to a remote.** Capture those permissions in the initial session. If a later operation requires a permission/credential not approved upfront, skip that operation, complete independent work and document the blocker; do not repeatedly interrupt the user during autonomous execution.

User-facing setup communication may be in **Spanish**; source code, code comments, README, docs, tickets and commit messages must be in **English**. Use concise, specific explanations during the interactive phase. When the user asks what a technical term means, connect it to concrete pieces of this project.

### Success definition

- A working Next.js + TypeScript application demonstrating **one genuine Mastra agent using tools**, a **Mastra workflow that suspends and resumes for human approval**, persisted PostgreSQL state on Supabase (local development fallback allowed), and **Langfuse traces** for live Claude calls.
- An interview-ready scenario: inspect a sample invoice, select/run reconciliation, see line-by-line differences and evidence, optionally approve/reject a flagged case, and inspect its trace/history.
- Rigorous separation of LLM interpretation from **deterministic monetary validation**.
- At least **12 reproducible, labeled scenarios** (primarily offline) with documented outcomes and a small controlled live-LLM smoke test when credits exist.
- A **publicly accessible read-only demo** and **owner-authenticated live actions**, if deployment passes the verified free-tier/compatibility/security gates. Otherwise a fully working local demo with a clear deployment blocker.
- Git repository clean at completion, or precise enumeration of intentionally uncommitted material; no tokens or credentials committed.

## 1. NON-NEGOTIABLE CONSTRAINTS

1. **Zero new fixed infrastructure spend**. Use only free tiers; no paid upgrade, metered paid add-on, premium plan, domain purchase, paid verification, auto top-up, or billable service activation. Existing Claude Max subscription is a sunk personal expense, not part of project costs. Anthropic API credits are **not identical** to Claude Code subscription usage.
2. **Claude API credits**: Max 5x currently advertises **$100 monthly API credit**, claimable after seven days, subject to actual account eligibility and balance. Confirm in Claude Console; never presume active or transferable. Use the **Claude API from Claude Console**, not Bedrock, GCP, or any other channel for these credits. No payment method is required to claim credits per official docs, but follow the UI's current requirements. Disable any extra usage/reload option if possible, verify spending controls; if a hard stop is not enforceable, avoid unattended paid calls.
3. **Nightly model budget**: default maximum **$3 estimated API spend** and **30 total live model requests** across development verification (both configurable downward during bootstrap), with a preferred **$1 initial smoke-test allocation**. Set a server-side application-level budget counter and per-run cap (e.g. no more than 3 model generations/rounds; max-output-tokens bounded); track estimates, usage and error cases. App limits reduce risk but are **not a substitute** for provider-side spending controls. Do not run expansive evaluations against the live API.
4. Only **synthetic, non-sensitive** invoices and suppliers. No actual payments, emails, real ERP integration, OCR, PDFs, storage buckets, embeddings, RAG, MCP server, multi-agent orchestration, or multi-tenant product features in this MVP.
5. Do not compromise robustness to create a flashy UI. Prefer a small functioning product to a large untested one.
6. **No silently changed architecture**. If an essential incompatibility is proven, apply the documented fallback policy (Section 5), record evidence and continue.
7. Avoid swallowing errors or pretending tests/deployments succeeded. Explicit `PASS`, `FAIL`, `SKIPPED`, and `BLOCKED` evidence in final report.
8. Never commit `.env*` secrets, API keys, database credentials, access tokens, credential exports, real user data or provider screenshots exposing secrets. Never echo secrets in logs, traces, README or terminal summaries. Do not ask the user to paste credentials into chat; instruct them to use local secret inputs, platform secret managers or approved CLI/browser login.
9. Do not create recurring keep-alive pings to dodge Supabase inactivity restrictions. Document the restoration procedure and reproducible database rebuild instead.
10. Keep implementation bounded to this single plan. No project phase explosion, no speculative extra services and no add-on roadmap disguised as required work.

## 2. DECISIONS ALREADY MADE — DO NOT REOPEN

| Area | Fixed decision |
|---|---|
| Coding agent | Claude Code with Claude Max 5x subscription |
| Runtime language | TypeScript / Node.js |
| AI framework | Mastra |
| AI provider | Anthropic Claude API, with user-claimed Max API credits |
| Agent topology | Exactly **one reconciliation agent** with at least two real tools |
| Process orchestration | Mastra workflow; deterministic steps + genuine suspend/resume human-in-the-loop |
| Data | JSON fixtures; invoice and purchase order with multiple item lines |
| Data store | PostgreSQL, preferably Supabase Free, with proper migrations and seeds |
| Observability | Langfuse Cloud free tier; instrument the actual agent/tool/model invocation |
| Frontend | Minimal Next.js UI (App Router), attractive enough for an interview demo |
| Hosting candidate | Vercel Hobby + Supabase Free, only if verified compatible |
| Local dev | Runnable end-to-end locally, including database via Docker Compose fallback |
| Monetary rules | Decimal/integer minor units in deterministic code, **never trust LLM arithmetic** |
| Review workflow | Suspended state persisted, later approved/rejected by authenticated human |
| Scope | Portfolio MVP, not a production invoicing/ERP/payments platform |

**Only user/account-specific choices remain**: credentials, account/project creation, access permissions, deployment public/private preferences, allowable API budget, Git remote, and any proven feasibility exception.

## 3. PHASE 0 — RESEARCH + INTERACTIVE HUMAN BOOTSTRAP (MANDATORY)

### 3A. Perform read-only discovery first

Before asking the user anything, inspect:

- Current working directory, repo structure, branch and Git remote, tracked/untracked/ignored files, and whether `InvoiceMatch AI` code already exists. **Never overwrite an existing project**.
- Node.js, preferred package manager (default npm if no project convention), Git, Docker, installed Claude CLI/auth session and any available vendor CLIs. Check only the **presence** of env keys, not their values. Do not print secrets.
- Whether there is a previously deployed SpendInsight-related Supabase project or existing Supabase account, **but do not touch it without explicit authorization**. Prefer a fresh, isolated InvoiceMatch project. Do not modify or delete SpendInsight.
- Latest official documentation and pricing for Mastra/Next.js, Mastra suspend/resume, Mastra PostgreSQL store, Langfuse integration, Supabase Free, Vercel Hobby, Anthropic API credits and rate limits. Verify documentation **at execution time** and note dates/URLs. Do not copy stale SDK samples verbatim if current versions differ.
- Whether Vercel Hobby is permitted for this personal non-commercial portfolio and whether a Next.js Node.js server function can reliably start, suspend, persist and resume a Mastra workflow *across process restarts and requests*. Must validate experimentally, not just infer from marketing docs.

Write findings and citation URLs in `docs/feasibility.md` with clear `VERIFIED`, `PENDING TEST`, or `NOT VIABLE` labels. Separate free-tier **quotas**, **inactivity**, **availability** and **paid overage** semantics. Never infer that a free-tier project has an uptime guarantee.

### 3B. One concentrated initial conversation with the user

Use an efficient **single grouped checklist** (and short necessary follow-ups) to settle all of the following, explicitly offering the defaults. Do not ask about choices already fixed in Section 2.

1. **Working directory & repo:** confirm/create an isolated `invoicematch-ai` repo, and whether to create/connect a GitHub remote; whether you may push a new feature branch and later open a PR. Default: local repo/branch; do **not** push or create remote without permission.
2. **Claude API credits:** ask user to claim/confirm credit balance in Claude Console if eligible, link the correct organization, and create a **restricted project/workspace API key** if the platform supports it. Confirm provider spend controls and prohibit automatic purchases. Default max app-estimated spend **$3** for this implementation and maximum **30 live model requests**. Never ask for a pasted key.
3. **Supabase:** ask user to authenticate by browser/CLI, verify free project slots and free plan, authorize creation of a **new** project/DB and migrations. If free project slots exhausted, ask whether to use a freshly authorized project; NEVER repurpose/delete SpendInsight silently. Default: create a new free `invoicematch-ai` project, EU region where available.
4. **Langfuse:** account and **EU** project/keys, with Free/Hobby tier confirmation. Default: EU cloud and free tier.
5. **Vercel:** account/CLI auth, Hobby eligibility and project creation permissions, confirm public-read-only/private-live pattern. Default: **public read-only results and demo explanation; owner-only live run/approval**. If user declines deployment, produce local app and scripts only.
6. **Owner authentication:** set an owner email allowlist and use Supabase Auth magic-link/OTP (or equally secure, proven provider-supported alternative). This is an additional auth use of the already chosen Supabase platform, **not** a new technology choice. Default: owner-only for live operations, public read-only examples. Do not expose service-role keys client-side.
7. **Authorization to deploy/push:** allow automated **free** deployment and Git push only if user explicitly approves during this session and safety gates pass. Create no paid resources. If missing, mark publish/deploy `BLOCKED_PERMISSION` and continue fully locally.
8. **Secrets setup:** user authenticates to vendors using official browser/CLI flows; Claude Code checks connectivity with harmless non-sensitive commands. Store required env vars in untracked `.env.local` or vendor-managed secrets; only key names in `.env.example`. Refuse credentials posted in chat; ask user to set them directly.

End setup with a compact table of agreed options and their permissions; write it to **`docs/bootstrap-decisions.md`** with NO secrets. Validate access with minimal no-cost checks. Ask the user explicitly to say **`GO AUTONOMOUS`**. **Do not start expensive live calls, resource creation, production deployment or remote push before that authorization**. If something cannot be resolved, offer a safe fallback and put its status in the table before asking for GO.

### 3C. During autonomy

After `GO AUTONOMOUS`, **do not ask additional questions**. Any step needing another secret, manual verification, OAuth prompt, billing action, CAPTCHA, production access or new authorization must be marked `BLOCKED_USER_ACTION` and bypassed. Continue to independent tests, local implementation, docs and Git finish. A blocked optional service is **not** grounds to abandon the entire project.

## 4. PRODUCT CONTRACT — EXACT MVP

### 4A. Domain model

- `Supplier`: UUID, code, name, optional tax identifier **fictional**.
- `PurchaseOrder`: UUID, PO number (unique), supplier ID, currency ISO, status (`OPEN`, `CLOSED`), line items, subtotal/tax/total (minor units or exact decimal), created at.
- `PurchaseOrderLine`: UUID, SKU/code, description, quantity exact decimal, unit price exact decimal, tax rate, line subtotal; unique within a PO by line ID, not by description.
- `Invoice`: UUID, invoice number, supplier ID, optional external PO reference, invoice date, currency ISO, multiline item rows, subtotal/tax/total, source JSON and created at.
- `Reconciliation`: UUID, invoice ID, selected PO ID nullable, Mastra workflow run ID, status, structured explanation, difference details, model/tracing correlation ID, timestamps and immutable decision history.
- `ReviewDecision`: UUID, reconciliation ID, reviewer identity, decision (`APPROVE`, `REJECT`), reason, timestamp, idempotency key.

Implement proper constraints, foreign keys, indexes, and explicit SQL migrations. Store both **business state** and **Mastra workflow snapshots** in durable PostgreSQL using the current supported Mastra PostgreSQL storage adapter, with isolated schema/prefix when appropriate to prevent collisions. Document how snapshots relate to reconciliation IDs. Supabase is the managed Postgres service, not a magical replacement for SQL schema design.

### 4B. Agent design

Create a **single Mastra `reconciliationAgent`**, using a Claude model/version **verified currently accessible** in the user's API account; do not hardcode an unsupported, outdated model. Use a supported Anthropic/AI SDK provider integration per current docs.

Real tools (Zod schemas / typed inputs and outputs):

1. `lookupPurchaseOrders` — query the DB by explicit reference or supplier and return bounded candidates; reject broad unbounded searches and cross-supplier leaks.
2. `getSupplierAndOrderDetails` — fetch exact supplier/PO details and all line items for a candidate.

The LLM's job is to **select/justify a PO candidate** where the invoice reference is missing/uncertain, identify semantic line correspondences, and articulate evidence or uncertainty. The LLM **must not compute final money values**, approve actual payments, change invoice data, or write its own decision to the database. Require structured, Zod-validated output: PO candidate ID or null, mapping list (invoiceLineId→poLineId or null), confidence category, reasons and evidence references. Validate against DB records; reject invented IDs/hallucinated tools. Tool calls must be visible in live traces. Limit context, tool iterations and output tokens. If there are no candidates, fall back to `UNMATCHED` without pretending the LLM found one.

### 4C. Deterministic matching and decision rules

- Validate JSON via Zod and reject non-finite, negative or impossible amounts/quantities. Use exact decimal arithmetic (e.g., decimal.js) and defined currency precision. No floating-point comparisons for money.
- Recompute line amounts, subtotal, tax and total from explicit inputs using a documented rounding policy. Detect internal arithmetic inconsistencies and flag them; do not overwrite source invoice numbers silently.
- Compare supplier identity, currency, PO status, duplicate invoice identifiers, PO/invoice reference, item identity, quantity, unit price, missing/extra lines, and totals.
- **Match statuses:** `MATCHED` (all material comparisons pass; finalize automatically), `REVIEW_REQUIRED` (mismatch, ambiguity, weak semantic mapping, or calculation disagreement), `UNMATCHED` (no valid PO), `REJECTED` (human rejected), `APPROVED_WITH_EXCEPTION` (human explicitly approved despite flagged mismatch), `FAILED` (technical error). Define exact status transition table and show it in UI/docs. Do not use approved status to imply money was paid.
- **No arbitrary tolerances.** Default zero tolerance for amount mismatches after rounding to currency minor units. Exact SKU match where available; ambiguous/semantic mapping requires review. Tax mismatches require review.
- Identical invoice numbers for the same supplier trigger duplicate detection and `REVIEW_REQUIRED` (not a hard silent acceptance). Invoice/PO in different currencies require review without conversion. Unmatched cases must be visible, never silently forced into one of several candidates.
- **Auditability:** every finding cites the specific invoice field/line ID and PO field/line ID plus exact delta and rule ID. Do not invent evidence.
- Agent output never overrides deterministic rule violations; it may provide only a labeled recommendation. Include structured `ruleFindings[]` with code, severity, target fields, actual/expected and exact delta.

### 4D. Mastra workflow

Implement an actual named Mastra workflow, not a hand-written function pretending to be one:

`validate input → persist invoice/run → agent lookup/mapping → deterministic reconciliation → conditional review gate → persist terminal state`.

- Auto-finalize a verified `MATCHED` case.
- A `REVIEW_REQUIRED` or materially ambiguous/unmatched case reaches a **real Mastra `suspend()`** step; keep snapshot in Postgres. Resume later with validated typed decision and reviewer identity; reject with `REJECTED`, approve with `APPROVED_WITH_EXCEPTION` as relevant.
- On process restart/new request, resolve the saved workflow run, load snapshot and resume — no in-memory callback or open browser connection required. UI refresh must show pending review.
- Use transactions/idempotency to prevent double invoice creation, duplicate decisions, concurrent approvals and workflow double-resume. Store decision before/with state change in a consistent sequence; if atomic transactions across Mastra internals and business tables aren't supported, implement explicit recovery/reconciliation rules and test them.
- Authorized reviewer must provide a reason for approving mismatched amounts. No actual financial external side effects.
- Provide API routes/actions: list seeded cases; start reconciliation; list/get reconciliations and findings; list pending reviews; approve/reject; health/status. Build explicit request schema validation and meaningful error codes.

### 4E. UI and demo

Use Next.js App Router + TypeScript with a compact, polished interface, **not a full ERP**. At minimum:

- Landing page explaining scenario and architecture and publicly accessible **precomputed read-only sample results**; no API key required to view.
- Invoice/PO side-by-side line comparison, clear difference amounts, rule findings and explanations linked to evidence.
- Owner-only button to run live AI reconciliation on selected synthetic sample; show progress and results.
- Owner-only pending review screen with explicit **Approve exception** / **Reject** and reason; show persisted audit trail after reload.
- Link to Langfuse project dashboard for owner with a trace ID (link only where grounded; do not expose keys or private Langfuse details to anonymous users).
- Mobile-readable styling and helpful empty/loading/error states.
- API request authentication checked **server-side** on every mutation, NOT just visually hidden buttons. Avoid anonymous invocation endpoints that spend tokens. Keep public data truly public and synthetic. Restrict reads that expose run internals to owner.

## 5. INFRASTRUCTURE & DEPLOYMENT DECISION ALGORITHM

This section defines a **controlled fallback**, not a choice to be reopened with the user during autonomous work.

### Preferred architecture

- Next.js App Router and Mastra imported/invoked in **server-side Node.js** code, possibly co-deployed on **Vercel Hobby** if supported.
- Supabase Free = **PostgreSQL** and (if bootstrapped) **owner authentication**. Use service credentials and DB connection only server-side. Choose SSL/connection pooling suitable for ephemeral serverless functions; confirm correct Supabase guidance.
- Langfuse Cloud Hobby (EU) via current supported Mastra tracing exporter/instrumentation.
- Anthropic Claude API using verified credits; read-only public examples remain functional without API credit.
- Local development: Next.js + Docker Compose Postgres (with equivalent schemas/migrations), Mastra Studio optional for developer inspection. Cloud database may be used for integration tests only once authenticated and approved.

### Mandatory feasibility gate before deploying

Prove each of these with documentation AND a runtime test when possible:

1. Deployed Next.js can invoke actual Mastra agent/tools; environment variables stay server-side.
2. Mastra's persisted workflow state uses **Postgres**, not filesystem or process memory.
3. `start → suspend → request completes → restart/redeploy/another invocation → resume` works with Vercel's execution model and plan limits.
4. No reliance on a long-running Node worker, cron sub-minute scheduling or long serverless request. The suspension must not occupy an HTTP function for hours.
5. Supabase Free limits, project pausing/restore and free project slot availability; do not assume perpetual uptime.
6. Vercel Hobby personal/noncommercial terms fit this project; free quotas sufficient for a tiny personal demo.
7. Authenticated live endpoints and spend guardrails prevent public abuse. No public anonymous endpoints generating billable calls.
8. Langfuse free-tier compatibility and reasonable tracing retention and cardinality.
9. Cloud app and restored DB can be reconstructed from tracked migrations/seed and documented steps.

### Exact fallback sequence

- **Preferred:** one Next.js + Mastra deployment on Vercel Hobby; Supabase Free PostgreSQL; Langfuse Hobby.
- **If Mastra runtime cannot be safely hosted together on Vercel Hobby:** first investigate a **separate free Mastra Node runtime** only if *documented, truly free and independently verifiable* with durable Postgres (no paid signup, no uncertain sleep behavior); keep Next.js frontend on Vercel. Document a short, evidence-based comparison and try **at most one** clearly feasible option. Never bind to an unverified free provider just for a URL.
- **If no compatible zero-cost runtime or deployment permissions exist:** ship working **local-only** architecture (Docker Postgres, Next.js/Mastra local, Langfuse if connected). Make the GitHub README demo-ready with screenshots and a short recorded-demo *script* (do not invent a recording); mark hosting as blocked, not 'deployed'.
- **If Supabase Free blocked/unavailable:** finish locally with Docker Postgres; include Supabase-specific setup and migrations awaiting owner intervention. Do not repurpose SpendInsight silently.
- **If Anthropic credits absent:** finish code, deterministic evaluation and mock agent path; perform no paid API calls. Flag live LLM integration `BLOCKED_CREDITS`; do not quietly switch to paid Gemini/OpenAI or other providers.
- **If Langfuse missing:** install exporter, test no-op configuration locally and retain instrumentation, mark end-to-end cloud trace verification blocked until keys exist.

A **deployment must never delay completion of a verified local MVP**. Do not add cron pings to keep Supabase active. Document dashboard-based restoration within provider policy; provide `db:reset` or equivalent repeatable scripts.

## 6. WORK BREAKDOWN — AUTONOMOUS STAGES

After the user says `GO AUTONOMOUS`, execute stages in order. At each stage: implement, run suitable automated checks, write concise checkpoint updates to `docs/progress.md`, commit cohesive, tested changes when safe. If an integration is blocked, progress on mock/offline implementation.

### Stage 1 — Repository, developer experience and skeleton

- Create isolated repository or safe feature branch according to bootstrapped permissions. If existing repo nonempty, respect conventions and preserve user's work; never force-clean.
- Configure Node LTS compatible with chosen releases, strict TypeScript, npm lockfile (unless repo uses another manager), ESLint, Prettier, unit test runner (Vitest preferred if compatible), simple Next.js UI.
- Add `.gitignore`, `.env.example` (key names only), `.nvmrc` or `engines`, `README.md`, `docs/architecture.md`, `docs/feasibility.md`, `docs/bootstrap-decisions.md`, `docs/progress.md`.
- Verify install, lint, typecheck and Next.js build before continuing.

### Stage 2 — DB and deterministic engine (offline first)

- Define schemas, SQL migrations and seed script; commit only fictional JSON fixtures.
- Create Docker Compose Postgres local dev and easy `db:migrate`, `db:seed`, `db:reset` scripts. Implement a clear adapter for cloud `DATABASE_URL` without business-logic duplication.
- Implement pure deterministic `reconcile` functions, monetary exactness and detailed evidence/rule findings. Unit-test boundary cases, duplicates, missing PO, supplier mismatch, currency mismatch, tax mismatch, missing/extra lines and valid matches.
- Ensure seeds and migrations are idempotent and replayable.

### Stage 3 — Mastra agent and workflow

- Build actual Mastra agent, register two DB-backed tools, enforce Zod contracts and bounded context.
- Implement separate **mocked agent adapter** for deterministic offline tests, plus live Anthropic adapter for approved use. Mock is never presented as genuine LLM evidence.
- Implement durable workflow state with Mastra's current PostgreSQL storage; accurate review suspension/resumption, duplicate-concurrency guard and error handling.
- Test `suspend/restart/resume` using a fresh app process or independent test process against same database, not merely within a single in-memory test function.

### Stage 4 — API and minimal Next.js interface

- Implement REST/server routes with schemas, explicit status codes, safe limits and structured errors.
- Seeded example browser, reconciliation details, side-by-side comparisons, pending human reviews, submit reasoned decisions, persisted audit history.
- Implement owner-only live activity via Supabase Auth or agreed equivalent, no insecure fallback in production. Public demo data is static/read-only.
- Ensure unauthorized mutation requests return denial even when bypassing the frontend.

### Stage 5 — Langfuse + evaluations

- Integrate actual traces: root reconciliation ID/run ID, span for agent call, spans for each tool, model name, token usage/cost estimate, outcome/error. Include failure visibility and bounded sanitized metadata. Never leak secrets or unnecessary invoice raw payloads.
- At least **12 versioned fixtures** with unambiguous labels covering: exact match, quantity mismatch, unit-price mismatch, missing line, extra line, wrong supplier, wrong currency, duplicate invoice, incorrect tax, incorrect invoice total, unknown PO, ambiguous candidate mapping. At least one human approval and rejection, plus one restart/resume test. Add more offline cases if cheap.
- Score deterministic matching using exact expected statuses, rule codes, and math; report accuracy as *N / N* with failed fixture identifiers. Maintain separate qualitative LLM-selection assessment; do **not** misrepresent deterministic fixtures as a validated model benchmark.
- Test with offline mocked LLM by default. If API credits approved, execute only a **small** live sample (initially 3–5 calls) with cost accounting, check tool usage and actual Langfuse trace IDs. Avoid batches without budgets.
- Save `evals/results/latest.json` (no secrets/private data), `docs/evaluation.md` and trace references sanitized.

### Stage 6 — Deployment if feasible and approved

- Perform exact gate from Section 5. Document actual runtime test/results in `docs/deployment-feasibility.md`.
- Create approved free Supabase project, apply migrations and seed only sample data. Never mix prod and destructive local reset commands.
- Deploy verified compatible application to approved Vercel Hobby or the approved documented fallback; configure server secrets in platform UI/CLI without printing them.
- Verify from **deployed URL**: public read-only page, owner auth, sample live agent/tool path (if approved credits), no anonymous API use, pending approval, resume after fresh invocation, DB state, trace arrival, and friendly handling of external rate limits and Supabase pause.
- Capture actual deployment URL(s), timestamps, last deployed Git commit and relevant provider console recovery steps. If blocked, state exact reason and finish local handoff.

### Stage 7 — Hardening, presentation and Git closure

- Run `npm ci`, lint, typecheck, unit/integration tests, build, safety/secret checks, eval suite. If feasible, add GitHub Actions CI that uses **no external secrets** and local Postgres service; run offline tests only.
- Test fresh-clone / documented bootstrap as far as locally feasible; document manual access actions separately.
- Provide `README.md`: what it does, architecture diagram in Mermaid, 60-second demo, tech stack, setup and env key names, local commands, demo credentials policy, evaluation summary, known limitations, costs, restore process, and interview talking points: **agent vs workflow**, **tool calling**, **HITL**, **observability/tracing**, **deterministic validation**, **Postgres persistence**.
- Ensure no TODOs in the critical path, no dummy traces, no static fake screenshots described as live results.
- Check `git status --short`, `git diff --check`, untracked files, ignore rules and whether branch is ahead/behind remote. Commit all intended code/docs/tests and the plan itself, respecting remote permissions. **Never force-push**. Pushing only if pre-approved. If an existing repo had uncommitted work at start, preserve and list it distinctly.
- Write **`FINAL_REPORT.md`** with exact tests run, results, live-vs-mock evidence, deployed URL (if any), cost/credit consumption estimate, blockers, unperformed steps, security checks, branch, commits, remote push status, pending manual actions, and the one-line demo command.

## 7. REQUIRED COMMANDS / FILE LAYOUT (GUIDE, NOT STALE SDK API)

Use a simple single Next.js repo unless the verified deployment needs separation. Suggested layout:

```text
invoicematch-ai/
├── MASTER_PLAN.md
├── README.md
├── FINAL_REPORT.md                  # created at end
├── .env.example
├── .gitignore
├── docker-compose.yml
├── migrations/
├── scripts/                          # migrate/seed/reset/eval helpers
├── data/fixtures/                    # synthetic multiline invoices and POs
├── src/
│   ├── app/                          # Next.js views and guarded API routes
│   ├── components/
│   ├── domain/                       # pure deterministic reconciliation
│   ├── db/                           # queries, migrations adapter, repository
│   ├── mastra/                       # agent, tools, workflow, storage, exporter
│   ├── server/                       # auth, service orchestration, API budget
│   └── schemas/                      # Zod contracts
├── tests/                            # pure, DB integration, security, workflow
├── evals/                            # scenarios and results
└── docs/                             # feasibility, decisions, architecture, progress
```

Expose stable npm scripts where feasible:

```text
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run db:migrate
npm run db:seed
npm run db:reset       # local ONLY, defensive guard for cloud URLs
npm run eval:offline
npm run eval:live     # explicit opt-in with verified credits/cap
```

**Do not fabricate scripts that do not work.** If framework/tool versions require different actual commands, update this section in `README.md` while preserving intent, with documented justification.

## 8. QUALITY & ACCEPTANCE CHECKLIST

No completion claim unless every relevant point below is evidenced. Mark blocked points rather than inventing success.

| Check | Acceptance criterion |
|---|---|
| Genuine agent | Mastra agent invokes real lookup tools with live Claude in at least one validated smoke when credits permitted |
| Correct calculations | All money, tax and quantities computed in deterministic exact-arithmetic code with reproducible edge-case tests |
| Multiline data | Two or more rows per invoice and PO; meaningful line-level differences |
| Durable HITL | Workflow suspends, process restarts, state reloads, owner approves/rejects, history persists |
| Security | Public demo cannot submit paid requests or approvals, arbitrary users cannot spoof owner |
| DB | SQL migrations and seed run locally and on approved Supabase without manual SQL copy-paste |
| Observability | Live trace includes correlation, model spans and tools in Langfuse if configured |
| Evaluation | >=12 labeled scenarios, actual scores, offline pass/fail report and live smoke clearly separated |
| UI | Works on desktop/mobile; public read-only example and owner review are demonstrable |
| Costs | Verified free infrastructure; no paid provisioning; live calls under approved cap |
| Deployment | Public URL with smoke if feasible and authorized, else documented local demo + exact blocker |
| Reproducibility | Fresh setup instructions and seed data sufficient to reconstruct a paused/deleted free project |
| Git | Checked branch/status, committed intended files, no secrets and no unapproved push |

### Critical-path tests (implement real tests, not just checklist statements)

1. Exact match → `MATCHED` with zero delta, no approval.
2. Qty/price/tax mismatch → precise finding + `REVIEW_REQUIRED` persisted.
3. No PO and two plausible POs → no false claim of certain match.
4. Inconsistent invoice declared total → deterministic finding.
5. One invoice submitted twice → no duplicate external side effects or duplicated approvals.
6. Concurrent/multiple review actions → one authorized terminal decision.
7. Suspend then reload under a separate process → approve and reject lead to correct statuses and immutable audit.
8. Anonymous HTTP POST to run/review → `401/403`, with **zero** LLM calls.
9. Simulated model outage/rate-limit → explicit state, safe retry boundaries, no fake matching.
10. Synthetic-only data and sanitized tracing → no secrets in Git, logs or traces.

## 9. MODELS, COSTS & AGENT EFFICIENCY

- Claude Code subscription may hit session/weekly limits; **do not bypass, buy extra usage or silently switch authentication to metered API**. If blocked by quota, persist detailed progress and final blockers; leave work resumable.
- Use the smaller/cheaper Claude model **supported by the account and good enough for structured tool calls** as default. Upgrade only when tests demonstrate inadequate quality, within approved API budget. Record exact model ID/version chosen, not generic marketing names.
- Keep a strict token/output cap per LLM call; keep at most 3 rounds/tool-call cycles per reconciliation in MVP; prioritize deterministic search by explicit PO number before fuzzy agent matching. Avoid re-running successful live fixtures needlessly.
- The **application** is not allowed to make unlimited requests while publicly deployed. Owner-only and rate-limited mutation routes, provider budgets if available, local capped usage ledger; fail closed when authorization or budget status is unknown.
- Langfuse Hobby has free limits and data retention. Do not upgrade to paid plans to keep traces longer.
- Avoid API web search, hosted OCR and vector services in runtime. No need for them here.

## 10. OFFICIAL REFERENCES TO RECHECK AT EXECUTION

- Mastra / Next.js integration: https://mastra.ai/integrations/frameworks/next-js
- Mastra workflow human approval UI: https://mastra.ai/integrations/agentic-ui/ai-sdk-ui
- Mastra workflow snapshots: https://mastra.ai/en/reference/workflows/snapshots
- Mastra Postgres storage concepts: https://mastra.ai/blog/introducing-managed-databases
- Langfuse–Mastra integration: https://langfuse.com/integrations/frameworks/mastra
- Langfuse pricing: https://langfuse.com/pricing
- Supabase Free pricing: https://supabase.com/pricing
- Supabase pausing and resuming: https://supabase.com/docs/guides/platform/free-project-pausing
- Vercel Hobby rules: https://vercel.com/docs/plans/hobby
- Vercel function duration (check CURRENT version): https://vercel.com/docs/functions/limitations
- Anthropic subscriber API credits (eligibility and billing): https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- Anthropic Claude API rate limits: https://docs.anthropic.com/en/api/rate-limits

**Sources are starting points, not permission to assume the integration works.** Prefer official 2026 docs and verify breaking API changes before implementation.

## 11. COMPLETION AND STOP CONDITIONS

**Stop and document, without requesting user intervention during autonomous operation**, if any of these occurs:

- Paid upgrade/deposit/card authorization is required.
- Current credentials are missing or an interactive browser login expires.
- Sensitive data would need to be exposed, a remote would need destructive operations, or a private repo would need to be made public without prior consent.
- A vendor service is incompatible with free-tier limits, or the only solution is an unapproved architecture change.
- Claude Code subscription usage limit is exhausted; leave repo and progress clean and resumable.

**Otherwise continue.** A blocked integration does **not** stop unit tests, UI, README, source code or offline evaluation. Prioritize local working proof over stalled cloud account setup.

### Final response format to the user (Spanish)

At the end of the autonomous run, provide a short, factual report:

- **Implemented:** concrete completed features.
- **Verified:** commands, test counts and whether any *real* Claude+Langfuse run succeeded.
- **Deployment:** actual URL or precise reason none exists; Supabase pausing caveat.
- **Costs:** API requests / estimated credit usage, new paid charges **€0 if confirmed**, otherwise explicitly unknown.
- **Git:** branch, commit hashes, pushed/not pushed and `git status`.
- **Manual actions pending:** only what could not be completed without user participation.
- **Demo:** simplest command/link to run/show the app.

**Finish all possible work in this run. Do not claim asynchronous work will continue after the Claude Code session exits.**
