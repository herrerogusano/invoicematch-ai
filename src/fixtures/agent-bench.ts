import { z } from "zod";
import catalogJson from "../../data/agent-bench/catalog.json";
import casesJson from "../../data/agent-bench/cases.json";
import { documentTotals, formatMoney } from "@/domain/money";
import {
  invoiceLineSchema,
  invoicePayloadSchema,
  purchaseOrderPayloadSchema,
  supplierSchema,
  type InvoicePayload,
} from "@/schemas/domain";

/**
 * Labeled benchmark for the reconciliation agent (PO selection and line mapping). It has its own
 * catalog so the public demo data stays unchanged; it is seeded only into a scratch database.
 */

export const BENCH_SPLITS = ["dev", "test"] as const;
export const BENCH_CATEGORIES = ["search", "many-candidates", "bad-reference", "injection", "abstain", "fixed-po"] as const;

const benchCatalogSchema = z.object({
  suppliers: z.array(supplierSchema),
  purchaseOrders: z.array(purchaseOrderPayloadSchema),
  historicalInvoices: z.array(invoicePayloadSchema),
});
export type BenchCatalog = z.infer<typeof benchCatalogSchema>;

const benchCaseSchema = z.object({
  id: z.string().regex(/^[ABM]\d{2}-[a-z0-9-]+$/),
  split: z.enum(BENCH_SPLITS),
  category: z.enum(BENCH_CATEGORIES),
  summary: z.string(),
  invoice: z.object({
    supplierCode: z.string(),
    poReference: z.string().nullable(),
    currency: z.enum(["EUR", "USD"]),
    lines: z.array(invoiceLineSchema.omit({ sku: true, lineSubtotal: true })).min(1),
  }),
  expected: z.object({
    poNumber: z.string().nullable(),
    lines: z.record(z.string(), z.string().nullable()),
  }),
});
type RawBenchCase = z.infer<typeof benchCaseSchema>;

export interface BenchCase extends Omit<RawBenchCase, "invoice"> {
  /** Full invoice payload; SKUs are always absent so the agent is the one doing the mapping. */
  invoice: InvoicePayload;
  /** True when the invoice references an existing PO, so the agent only maps lines. */
  fixedPo: boolean;
}

export const benchCatalog: BenchCatalog = benchCatalogSchema.parse(catalogJson);

function toInvoice(c: RawBenchCase): InvoicePayload {
  const totals = documentTotals(c.invoice.lines, c.invoice.currency);
  return invoicePayloadSchema.parse({
    invoiceNumber: `BENCH-${c.id.slice(0, 3)}`,
    supplierCode: c.invoice.supplierCode,
    poReference: c.invoice.poReference,
    invoiceDate: "2026-10-20",
    currency: c.invoice.currency,
    lines: c.invoice.lines.map((l) => ({ ...l, sku: null })),
    declared: {
      subtotal: formatMoney(totals.subtotal, c.invoice.currency),
      tax: formatMoney(totals.tax, c.invoice.currency),
      total: formatMoney(totals.total, c.invoice.currency),
    },
  });
}

/** Fails loudly when a label points at a PO or PO line that does not exist or is out of scope. */
export function validateLabels(cases: RawBenchCase[], catalog: BenchCatalog): void {
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate bench case ${c.id}`);
    ids.add(c.id);
    if (!catalog.suppliers.some((s) => s.code === c.invoice.supplierCode)) throw new Error(`${c.id}: unknown supplier`);
    const invoiceLineIds = c.invoice.lines.map((l) => l.lineId).sort();
    if (JSON.stringify(Object.keys(c.expected.lines).sort()) !== JSON.stringify(invoiceLineIds)) {
      throw new Error(`${c.id}: expected.lines must label every invoice line exactly once`);
    }
    const po = c.expected.poNumber ? catalog.purchaseOrders.find((p) => p.poNumber === c.expected.poNumber) : null;
    if (c.expected.poNumber && !po) throw new Error(`${c.id}: expected PO ${c.expected.poNumber} not in catalog`);
    if (po && (po.supplierCode !== c.invoice.supplierCode || po.status !== "OPEN")) {
      throw new Error(`${c.id}: expected PO must be an OPEN PO of the invoice's supplier`);
    }
    const poLineIds = new Set(po?.lines.map((l) => l.lineId) ?? []);
    const used = new Set<string>();
    for (const target of Object.values(c.expected.lines)) {
      if (target === null) continue;
      if (!po) throw new Error(`${c.id}: line mapped although no PO is expected`);
      if (!poLineIds.has(target)) throw new Error(`${c.id}: ${target} is not a line of ${po.poNumber}`);
      if (used.has(target)) throw new Error(`${c.id}: ${target} mapped twice`);
      used.add(target);
    }
    const refExists = c.invoice.poReference !== null && catalog.purchaseOrders.some((p) => p.poNumber === c.invoice.poReference);
    if ((c.category === "fixed-po") !== refExists) throw new Error(`${c.id}: fixed-po cases (and only those) reference an existing PO`);
  }
}

const rawCases = z.object({ version: z.number(), cases: z.array(benchCaseSchema).min(30) }).parse(casesJson).cases;
validateLabels(rawCases, benchCatalog);

export const benchCases: BenchCase[] = rawCases.map((c) => ({
  ...c,
  invoice: toInvoice(c),
  fixedPo: c.category === "fixed-po",
}));
