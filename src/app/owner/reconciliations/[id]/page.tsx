import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DecisionForm } from "@/components/client";
import { ReconciliationView } from "@/components/ReconciliationView";
import { Card, Notice, Shell, StatusBadge } from "@/components/ui";
import { getReconciliationDetail } from "@/db/repository";
import { PENDING_REVIEW_STATUSES } from "@/domain/status";
import { requireOwnerPage } from "@/server/page-auth";

export const dynamic = "force-dynamic";

function langfuseTraceUrl(traceId: string | null): string | null {
  const base = process.env.LANGFUSE_PROJECT_URL;
  if (!traceId || !base || !process.env.LANGFUSE_PUBLIC_KEY) return null;
  return `${base.replace(/\/$/, "")}/traces/${encodeURIComponent(traceId)}`;
}

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const d = await getReconciliationDetail(id);
  if (!d) notFound();
  const agent = d.agentOutput as { mode?: string; toolCalls?: string[] } | null;
  const pending = PENDING_REVIEW_STATUSES.includes(d.status);
  const traceUrl = langfuseTraceUrl(d.traceId);

  return (
    <Shell owner={owner}>
      <div className="space-y-1">
        <Link href="/owner" className="text-sm text-slate-500 hover:text-slate-900">← Owner console</Link>
        <h1 className="text-2xl font-bold">Reconciliation {d.invoiceNumber}</h1>
        <p className="font-mono text-xs text-slate-400">id {d.id} · workflow run {d.workflowRunId}</p>
      </div>

      {d.status === "FAILED" && (
        <Notice tone="error">
          Technical failure <b>{d.errorCode}</b>: {d.errorMessage}. No matching result is claimed. Start a new run once the cause is fixed.
        </Notice>
      )}

      {pending && (
        <Card title="Review required" className="border-amber-300">
          <p className="mb-3 text-sm text-slate-600">
            This run is suspended at the <code>review-gate</code> step. Your decision is stored first, then the workflow resumes from its Postgres snapshot.
          </p>
          <DecisionForm reconciliationId={d.id} />
        </Card>
      )}

      {d.decision && (
        <Card title="Decision">
          <p className="text-sm">
            <b>{d.decision.decision}</b> by {d.decision.reviewer} on {new Date(d.decision.createdAt).toLocaleString("en-GB")}
          </p>
          <p className="mt-1 rounded bg-slate-50 p-2 text-sm text-slate-700">“{d.decision.reason}”</p>
          <p className="mt-1 text-xs text-slate-500">Workflow resume: {d.decision.resumeStatus}</p>
        </Card>
      )}

      <ReconciliationView
        invoiceNumber={d.invoiceNumber}
        supplierName={d.supplierName}
        poNumber={d.poNumber}
        currency={d.currency}
        status={d.status}
        result={d.result}
        agent={{ invoked: d.agentInvoked, mode: agent?.mode ?? d.agentMode, toolCalls: agent?.toolCalls }}
      />

      <Card title="Audit trail (append-only)" actions={traceUrl ? <a href={traceUrl} target="_blank" rel="noreferrer" className="text-xs text-violet-700 underline">Open trace in Langfuse</a> : <span className="text-xs text-slate-400">{d.traceId ? `trace ${d.traceId.slice(0, 12)}… (Langfuse not configured)` : "no trace"}</span>}>
        <ol className="space-y-2">
          {d.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 text-sm">
              <span className="w-40 shrink-0 font-mono text-xs text-slate-400">{new Date(e.createdAt).toLocaleString("en-GB")}</span>
              <span className="font-semibold">{e.eventType}</span>
              <span className="text-slate-500">{e.actor}</span>
              {"status" in e.payload && <StatusBadge status={String(e.payload.status)} />}
              {"reason" in e.payload && <span className="text-slate-600">“{String(e.payload.reason)}”</span>}
              {"toolCalls" in e.payload && Array.isArray(e.payload.toolCalls) && e.payload.toolCalls.length > 0 && (
                <span className="text-xs text-slate-500">tools: {(e.payload.toolCalls as string[]).join(", ")}</span>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}
