import samplesJson from "../../data/samples/precomputed.json";
import type { ReconcileResult } from "@/domain/reconcile";

/**
 * Public read-only sample results, precomputed by `npm run eval:offline` (mock agent, synthetic data)
 * and committed. Serving them needs no database, no model and no credentials.
 */
export interface PublicSample {
  scenarioId: string;
  title: string;
  summary: string;
  invoiceNumber: string;
  supplierName: string;
  poNumber: string | null;
  currency: string;
  status: string;
  result: ReconcileResult & { poSelection?: string; candidateCount?: number; explanation?: string | null };
  agent: { invoked: boolean; mode: string; toolCalls: string[] };
}

export interface PublicSamples {
  generatedAt: string;
  generator: string;
  disclaimer: string;
  samples: PublicSample[];
}

export function publicSamples(): PublicSamples {
  return samplesJson as unknown as PublicSamples;
}

export function publicSample(id: string): PublicSample | undefined {
  return publicSamples().samples.find((s) => s.scenarioId === id);
}
