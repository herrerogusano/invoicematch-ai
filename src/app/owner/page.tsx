import Link from "next/link";
import { LogoutButton, RunScenarioButton } from "@/components/client";
import { Card, Notice, Shell, StatusBadge } from "@/components/ui";
import { listReconciliations, type ReconciliationSummary } from "@/db/repository";
import { scenarios } from "@/fixtures";
import { agentMode } from "@/mastra/agent";
import { requireOwnerPage } from "@/server/page-auth";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  const owner = await requireOwnerPage();
  let recent: ReconciliationSummary[] = [];
  let dbError = false;
  try {
    recent = await listReconciliations({ limit: 25 });
  } catch {
    dbError = true;
  }
  const mode = agentMode();
  return (
    <Shell owner={owner}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Owner console</h1>
        <LogoutButton />
      </div>
      {mode === "mock" ? (
        <Notice>Agent mode: <b>mock</b>. Runs use the real Mastra workflow, tools and database with a scripted offline model; no API credits are spent.</Notice>
      ) : (
        <Notice tone="warn">Agent mode: <b>live Claude</b>. Each run that needs the agent spends API credits within the server-side budget cap.</Notice>
      )}
      {dbError && <Notice tone="error">Database unavailable. If this is a Supabase Free project it may be paused; restore it from the Supabase dashboard.</Notice>}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Run a synthetic scenario" className="lg:col-span-3">
          <ul className="divide-y divide-slate-100">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="truncate text-xs text-slate-500">{s.summary}</p>
                </div>
                <RunScenarioButton scenarioId={s.id} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Running a scenario again stores a second invoice with the same number, so it is flagged as a duplicate by design.</p>
        </Card>
        <Card title="Recent reconciliations" className="lg:col-span-2" actions={<Link href="/owner/reviews" className="text-xs text-slate-500 underline">Pending reviews</Link>}>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet. Start one on the left.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/owner/reconciliations/${r.id}`} className="flex items-center justify-between gap-2 hover:underline">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold">{r.invoiceNumber}</span>
                      <span className="block truncate text-xs text-slate-500">{r.scenarioId ?? r.supplierCode} · {new Date(r.createdAt).toLocaleString("en-GB")}</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
