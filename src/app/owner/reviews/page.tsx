import Link from "next/link";
import { Card, Shell, StatusBadge } from "@/components/ui";
import { listReconciliations } from "@/db/repository";
import { requireOwnerPage } from "@/server/page-auth";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const owner = await requireOwnerPage();
  const pending = await listReconciliations({ statuses: ["REVIEW_REQUIRED", "UNMATCHED"] });
  return (
    <Shell owner={owner}>
      <h1 className="text-2xl font-bold">Pending reviews</h1>
      <p className="text-sm text-slate-600">Each item is a Mastra workflow run suspended at the review gate. Its state lives in Postgres, so it survives restarts and redeploys.</p>
      <Card>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing is waiting for review.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((r) => (
              <li key={r.id} className="py-2.5">
                <Link href={`/owner/reconciliations/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 hover:underline">
                  <span className="text-sm">
                    <span className="font-semibold">{r.invoiceNumber}</span> · {r.supplierName}
                    <span className="block text-xs text-slate-500">
                      {r.findingCount} finding(s) · {r.poNumber ?? "no PO"} · {new Date(r.createdAt).toLocaleString("en-GB")}
                    </span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
