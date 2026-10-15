import Link from "next/link";
import type { ReactNode } from "react";

const STATUS_STYLE: Record<string, string> = {
  MATCHED: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-900 ring-amber-200",
  UNMATCHED: "bg-orange-100 text-orange-900 ring-orange-200",
  APPROVED_WITH_EXCEPTION: "bg-sky-100 text-sky-900 ring-sky-200",
  REJECTED: "bg-rose-100 text-rose-800 ring-rose-200",
  FAILED: "bg-slate-200 text-slate-800 ring-slate-300",
  PROCESSING: "bg-violet-100 text-violet-800 ring-violet-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  ERROR: "bg-rose-50 text-rose-700 ring-rose-200",
  WARNING: "bg-amber-50 text-amber-800 ring-amber-200",
  INFO: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${SEVERITY_STYLE[severity] ?? ""}`}>{severity}</span>;
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Shell({ children, owner }: { children: ReactNode; owner?: string | null }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs text-white">IM</span>
            InvoiceMatch AI
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            <Link href="/#samples" className="hover:text-slate-900">Samples</Link>
            <Link href="/owner" className="hover:text-slate-900">Owner console</Link>
            {owner && <Link href="/owner/reviews" className="hover:text-slate-900">Reviews</Link>}
            {owner && <span className="hidden text-xs text-slate-400 sm:inline">{owner}</span>}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-400">
        Portfolio proof of concept. Synthetic, fictional data only. No payments, emails or ERP integration.
      </footer>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const style = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", error: "border-rose-200 bg-rose-50 text-rose-900" }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${style}`}>{children}</div>;
}
