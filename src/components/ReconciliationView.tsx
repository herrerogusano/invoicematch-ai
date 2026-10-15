import type { ReconcileResult, RuleFinding } from "@/domain/reconcile";
import { Card, SeverityBadge, StatusBadge } from "./ui";

export interface ReconciliationViewProps {
  invoiceNumber: string;
  supplierName: string;
  poNumber: string | null;
  currency: string;
  status: string;
  result: (ReconcileResult & { poSelection?: string; candidateCount?: number; explanation?: string | null }) | null;
  agent: { invoked: boolean; mode: string; toolCalls?: string[] };
}

function ref(r: RuleFinding["invoiceRef"]) {
  if (!r) return "—";
  return r.lineId ? `line ${r.lineId} · ${r.field}` : r.field;
}

const SELECTION_LABEL: Record<string, string> = {
  REFERENCE: "explicit PO reference on the invoice",
  AGENT: "selected by the agent (needs review)",
  NONE: "no purchase order associated",
};

export function ReconciliationView({ invoiceNumber, supplierName, poNumber, currency, status, result, agent }: ReconciliationViewProps) {
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Invoice</p>
            <p className="text-lg font-semibold">{invoiceNumber}</p>
            <p className="text-sm text-slate-600">{supplierName}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Purchase order</p>
            <p className="text-lg font-semibold">{poNumber ?? "—"}</p>
            <p className="text-sm text-slate-600">{result?.poSelection ? SELECTION_LABEL[result.poSelection] : ""}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
            <StatusBadge status={status} />
            <p className="mt-1 text-xs text-slate-500">{currency}</p>
          </div>
        </div>
      </Card>

      {result && (
        <>
          <Card title="Totals (recomputed with exact decimals)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 pr-3"></th>
                    <th className="py-1 pr-3 text-right">Declared on invoice</th>
                    <th className="py-1 pr-3 text-right">Recomputed</th>
                    <th className="py-1 text-right">Purchase order</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {(["subtotal", "tax", "total"] as const).map((k) => {
                    const off = result.declaredTotals[k] !== result.invoiceTotals[k];
                    return (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 font-sans capitalize text-slate-600">{k}</td>
                        <td className={`py-1.5 pr-3 text-right ${off ? "font-semibold text-rose-700" : ""}`}>{result.declaredTotals[k]}</td>
                        <td className="py-1.5 pr-3 text-right">{result.invoiceTotals[k]}</td>
                        <td className="py-1.5 text-right">{result.poTotals?.[k] ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Line-by-line comparison">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Invoice line</th>
                    <th className="py-1 pr-2 text-right">Qty</th>
                    <th className="py-1 pr-2 text-right">Unit</th>
                    <th className="py-1 pr-2 text-right">Tax</th>
                    <th className="py-1 pr-4 text-right">Subtotal</th>
                    <th className="py-1 pr-2">PO line</th>
                    <th className="py-1 pr-2 text-right">Qty</th>
                    <th className="py-1 pr-2 text-right">Unit</th>
                    <th className="py-1 pr-2 text-right">Tax</th>
                    <th className="py-1 pr-2 text-right">Subtotal</th>
                    <th className="py-1 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l, i) => {
                    const diff = (a?: string, b?: string) => (a !== undefined && b !== undefined && a !== b ? "bg-rose-50 font-semibold text-rose-700" : "");
                    return (
                      <tr key={i} className={`border-t border-slate-100 align-top ${l.ok ? "" : "bg-amber-50/40"}`}>
                        <td className="py-2 pr-2">
                          {l.invoice ? (
                            <>
                              <div className="font-medium">{l.invoice.description}</div>
                              <div className="text-xs text-slate-500">#{l.invoiceLineId} {l.invoice.sku ? `· ${l.invoice.sku}` : "· no SKU"}</div>
                            </>
                          ) : (
                            <span className="text-xs italic text-rose-700">not invoiced</span>
                          )}
                        </td>
                        <td className={`py-2 pr-2 text-right font-mono tabular-nums ${diff(l.invoice?.quantity, l.po?.quantity)}`}>{l.invoice?.quantity ?? ""}</td>
                        <td className={`py-2 pr-2 text-right font-mono tabular-nums ${diff(l.invoice?.unitPrice, l.po?.unitPrice)}`}>{l.invoice?.unitPrice ?? ""}</td>
                        <td className={`py-2 pr-2 text-right font-mono tabular-nums ${diff(l.invoice?.taxRate, l.po?.taxRate)}`}>{l.invoice?.taxRate ?? ""}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums">{l.invoice?.subtotal ?? ""}</td>
                        <td className="py-2 pr-2">
                          {l.po ? (
                            <>
                              <div className="font-medium">{l.po.description}</div>
                              <div className="text-xs text-slate-500">
                                #{l.poLineId} {l.po.sku ? `· ${l.po.sku}` : ""}
                                {l.basis && <span className={`ml-1 rounded px-1 ${l.basis === "SKU" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{l.basis === "SKU" ? "SKU match" : "semantic"}</span>}
                              </div>
                            </>
                          ) : (
                            <span className="text-xs italic text-rose-700">no PO line</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums">{l.po?.quantity ?? ""}</td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums">{l.po?.unitPrice ?? ""}</td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums">{l.po?.taxRate ?? ""}</td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums">{l.po?.subtotal ?? ""}</td>
                        <td className={`py-2 text-right font-mono tabular-nums ${l.subtotalDelta && l.subtotalDelta !== "0.00" && l.subtotalDelta !== "0" ? "font-semibold text-rose-700" : "text-slate-400"}`}>{l.subtotalDelta ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Rule findings (${result.findings.length})`}>
            {result.findings.length === 0 ? (
              <p className="text-sm text-emerald-700">All material comparisons passed with zero tolerance.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {result.findings.map((f, i) => (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <code className="text-xs font-semibold text-slate-800">{f.ruleId}</code>
                      <span className="text-slate-700">{f.message}</span>
                    </div>
                    <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:grid-cols-2">
                      <span>Invoice: {ref(f.invoiceRef)}</span>
                      <span>PO: {ref(f.poRef)}</span>
                      {(f.actual !== null || f.expected !== null) && (
                        <span className="font-mono">
                          actual {f.actual ?? "—"} · expected {f.expected ?? "—"}
                          {f.delta !== null && <> · Δ {f.delta}</>}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card title="Agent">
        {agent.invoked ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${agent.mode === "mock" ? "bg-slate-200 text-slate-700" : "bg-violet-100 text-violet-800"}`}>
                {agent.mode === "mock" ? "MOCK MODEL (offline stand-in, not an LLM)" : `LIVE · ${agent.mode}`}
              </span>
              tools called: {agent.toolCalls?.length ? agent.toolCalls.join(", ") : "—"}
            </p>
            {result?.explanation && (
              <p className="rounded bg-slate-50 p-2 text-slate-700">
                <span className="text-xs font-semibold uppercase text-slate-500">Recommendation only · </span>
                {result.explanation}
              </p>
            )}
            <p className="text-xs text-slate-500">The agent proposes a PO and line correspondences. It never computes amounts and cannot override a rule finding.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Not needed: the PO came from an explicit reference and every line matched by exact SKU (or no candidate existed).</p>
        )}
      </Card>
    </div>
  );
}
