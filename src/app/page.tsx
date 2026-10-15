import Link from "next/link";
import { Card, Shell, StatusBadge } from "@/components/ui";
import { STATUS_DESCRIPTIONS, STATUS_TRANSITIONS } from "@/domain/status";
import { publicSamples } from "@/server/samples";

const STEPS = [
  ["validate-input", "Zod schema: exact decimal strings, no negatives, NaN or exponents"],
  ["persist-invoice-and-run", "Invoice + reconciliation row in one transaction, idempotency key"],
  ["agent-lookup-mapping", "Explicit PO reference first; the agent is called only for what remains"],
  ["deterministic-reconcile", "decimal.js, currency minor units, zero tolerance, rule findings"],
  ["review-gate", "MATCHED passes; anything else calls Mastra suspend() and waits in Postgres"],
  ["persist-terminal-state", "Owner decision resumes the run from any process: approve or reject"],
];

export default function HomePage() {
  const { samples, generatedAt, disclaimer } = publicSamples();
  return (
    <Shell>
      <section className="space-y-3 pt-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Invoice ↔ purchase order reconciliation</h1>
        <p className="max-w-3xl text-slate-600">
          One Mastra agent with two database tools proposes which purchase order an invoice belongs to and how its lines correspond.
          Exact-decimal code makes every money decision. Anything that is not a clean match is suspended in a durable Mastra
          workflow until the owner approves or rejects it with a reason.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <a href="#samples" className="rounded-md bg-slate-900 px-3 py-2 font-semibold text-white">Browse sample results</a>
          <Link href="/owner" className="rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold">Owner console</Link>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Architecture">
          <div className="grid gap-2 text-sm">
            {[
              ["Next.js App Router", "public read-only pages · owner-only API routes (server-side auth)"],
              ["Mastra workflow", "6 steps, real suspend()/resume, snapshot in Postgres"],
              ["Mastra agent", "lookupPurchaseOrders · getSupplierAndOrderDetails (supplier-scoped)"],
              ["Deterministic engine", "decimal.js rules → ruleFindings[] with exact deltas"],
              ["PostgreSQL", "app schema (business, audit) · mastra schema (snapshots)"],
              ["Tracing", "Mastra observability → Langfuse when keys are configured"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col rounded-lg border border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="w-44 shrink-0 font-semibold">{k}</span>
                <span className="text-slate-600">{v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Workflow: reconciliationWorkflow">
          <ol className="space-y-2 text-sm">
            {STEPS.map(([id, text], i) => (
              <li key={id} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold">{i + 1}</span>
                <span>
                  <code className="text-xs font-semibold">{id}</code>
                  <span className="block text-slate-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="Status transitions">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Meaning</th><th className="py-1">Can become</th></tr>
            </thead>
            <tbody>
              {Object.entries(STATUS_TRANSITIONS).map(([s, next]) => (
                <tr key={s} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3"><StatusBadge status={s} /></td>
                  <td className="py-2 pr-3 text-slate-600">{STATUS_DESCRIPTIONS[s as keyof typeof STATUS_DESCRIPTIONS]}</td>
                  <td className="py-2 text-xs text-slate-600">{next.length ? next.join(", ") : "terminal"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section id="samples" className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Sample results ({samples.length} labeled scenarios)</h2>
          <p className="text-sm text-slate-500">
            Precomputed {new Date(generatedAt).toISOString().slice(0, 10)} · {disclaimer}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {samples.map((s) => (
            <Link key={s.scenarioId} href={`/samples/${s.scenarioId}`} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-400">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-slate-400">{s.scenarioId.slice(0, 3)}</span>
                <StatusBadge status={s.status} />
              </div>
              <h3 className="font-semibold group-hover:underline">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
              <p className="mt-2 text-xs text-slate-500">
                {s.result.findings.length ? s.result.findings.map((f) => f.ruleId).join(" · ") : "no findings"}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}
