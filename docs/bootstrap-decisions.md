# Bootstrap decisions (MASTER_PLAN §3B)

Agreed with the owner on 2026-10-15. No secrets in this file.

| # | Topic | Decision | Permission / status |
|---|---|---|---|
| 1 | Repository | Isolated local repo `invoicematch-ai`; private GitHub repo `herrerogusano/invoicematch-ai`; push a feature branch; never force-push | APPROVED (create private repo, push branch) |
| 2 | Claude API credits | Promotional API credits claimed 2026-10-21 ($100 with the Max plan, granted again each billing cycle without rollover, no payment method). Since 2026-10-27 the key is `invoicematch-ai-prod`, Default workspace, no expiry. Local cap $3 / 30 requests; production cap in `docs/deployment-feasibility.md` | DONE |
| 3 | Supabase | Deferred; local Docker Postgres. A new free project will be created later, never reusing SpendInsight | BLOCKED_USER_ACTION |
| 4 | Langfuse | Langfuse Cloud EU, Hobby (free) project; keys only in `.env.local`. Exporter stays a no-op without keys | DONE 2026-10-15 (delivery verified) |
| 5 | Vercel | No deployment in this run | BLOCKED_USER_ACTION |
| 6 | Owner authentication | Local signed-session adapter now (refused on deployed environments); Supabase Auth adapter wired for later. Owner allowlist via `OWNER_EMAILS` | APPROVED (local) |
| 7 | Deploy / push | Push allowed for the private repo feature branch; no deployment | APPROVED (push) · BLOCKED (deploy) |
| 8 | Secrets | Only `.env.local` (git-ignored) and vendor secret stores; `.env.example` lists key names only | APPROVED |
| — | Harness files | `.harness/invoicematch-ai/` versioned with the repo | APPROVED |

Changes during the run:

- Local auth refusal is keyed on deployed-environment markers (`VERCEL`, `DEPLOYED`) instead of `NODE_ENV=production`, because `next start` sets `NODE_ENV=production` locally too. The intent (no passphrase login in a deployment) is unchanged.
