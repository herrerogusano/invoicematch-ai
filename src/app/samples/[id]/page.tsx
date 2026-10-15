import Link from "next/link";
import { notFound } from "next/navigation";
import { ReconciliationView } from "@/components/ReconciliationView";
import { Notice, Shell } from "@/components/ui";
import { publicSample, publicSamples } from "@/server/samples";

export function generateStaticParams() {
  return publicSamples().samples.map((s) => ({ id: s.scenarioId }));
}

export default async function SamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = publicSample(id);
  if (!s) notFound();
  return (
    <Shell>
      <div className="space-y-1">
        <Link href="/#samples" className="text-sm text-slate-500 hover:text-slate-900">← All samples</Link>
        <h1 className="text-2xl font-bold">{s.title}</h1>
        <p className="text-slate-600">{s.summary}</p>
      </div>
      <Notice>Read-only precomputed result on synthetic data. Agent choices in samples come from the offline mock model.</Notice>
      <ReconciliationView
        invoiceNumber={s.invoiceNumber}
        supplierName={s.supplierName}
        poNumber={s.poNumber}
        currency={s.currency}
        status={s.status}
        result={s.result}
        agent={s.agent}
      />
    </Shell>
  );
}
