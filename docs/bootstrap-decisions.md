# Bootstrap decisions (MASTER_PLAN §3B)

Agreed with the owner on 2026-10-15. No secrets in this file.

| # | Topic | Decision | Permission / status |
|---|---|---|---|
| 1 | Repository | Isolated local repo `invoicematch-ai`; private GitHub repo `herrerogusano/invoicematch-ai`; push a feature branch; never force-push | APPROVED (create private repo, push branch) |
| 2 | Claude API credits | Not yet available (subscription is under 7 days old; expected from 2026-10-16). Mock agent adapter until then. Default cap for later: $3 estimated / 30 live requests, confirmed when credits exist | BLOCKED_CREDITS |
| 3 | Supabase | Deferred; local Docker Postgres. A new free project will be created later, never reusing SpendInsight | BLOCKED_USER_ACTION |
| 4 | Langfuse | Deferred; exporter installed, no-op without keys | BLOCKED_USER_ACTION |
| 5 | Vercel | No deployment in this run | BLOCKED_USER_ACTION |
| 6 | Owner authentication | Local signed-session adapter now (refused on deployed environments); Supabase Auth adapter wired for later. Owner allowlist via `OWNER_EMAILS` | APPROVED (local) |
| 7 | Deploy / push | Push allowed for the private repo feature branch; no deployment | APPROVED (push) · BLOCKED (deploy) |
| 8 | Secrets | Only `.env.local` (git-ignored) and vendor secret stores; `.env.example` lists key names only | APPROVED |
| — | Harness files | `.harness/invoicematch-ai/` versioned with the repo | APPROVED |

Changes during the run:

- Local auth refusal is keyed on deployed-environment markers (`VERCEL`, `DEPLOYED`) instead of `NODE_ENV=production`, because `next start` sets `NODE_ENV=production` locally too. The intent (no passphrase login in a deployment) is unchanged.
