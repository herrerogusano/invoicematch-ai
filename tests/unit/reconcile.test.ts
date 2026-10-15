import { describe, expect, it } from "vitest";
import {
  mapLinesBySku,
  reconcile,
  type DomainInvoice,
  type DomainPurchaseOrder,
  type ReconcileContext,
} from "@/domain/reconcile";

const po: DomainPurchaseOrder = {
  id: "po-1",
  poNumber: "PO-1",
  supplierId: "sup-1",
  currency: "EUR",
  status: "OPEN",
  lines: [
    { lineId: "P1", sku: "AAA", description: "Widget", quantity: "10", unitPrice: "2.50", taxRate: "0.21" },
    { lineId: "P2", sku: "BBB", description: "Gadget", quantity: "1", unitPrice: "99.99", taxRate: "0.21" },
  ],
};

function invoice(overrides: Partial<DomainInvoice> = {}, lineOverrides: Array<Record<string, unknown>> = []): DomainInvoice {
  const lines = [
    { lineId: "1", sku: "AAA", description: "Widget", quantity: "10", unitPrice: "2.50", taxRate: "0.21" },
    { lineId: "2", sku: "BBB", description: "Gadget", quantity: "1", unitPrice: "99.99", taxRate: "0.21" },
  ].map((l, i) => ({ ...l, ...(lineOverrides[i] ?? {}) }));
  return {
    invoiceNumber: "INV-1",
    supplierId: "sup-1",
    poReference: "PO-1",
    currency: "EUR",
    lines,
    // 25.00 + 99.99 = 124.99; tax 5.25 + 21.00 (20.9979) = 26.25; total 151.24
    declared: { subtotal: "124.99", tax: "26.25", total: "151.24" },
    ...overrides,
  };
}

const ctx = (c: Partial<ReconcileContext> = {}): ReconcileContext => ({
  duplicateInvoiceIds: [],
  poSelection: "REFERENCE",
  candidateCount: 1,
  agentConfidence: null,
  ...c,
});

const run = (inv: DomainInvoice, p: DomainPurchaseOrder | null = po, c = ctx()) =>
  reconcile(inv, p, p ? mapLinesBySku(inv.lines, p.lines) : [], c);
const ids = (r: ReturnType<typeof run>) => r.findings.map((f) => f.ruleId).sort();

describe("reconcile", () => {
  it("exact match → MATCHED with zero deltas", () => {
    const r = run(invoice());
    expect(r.status).toBe("MATCHED");
    expect(r.findings).toEqual([]);
    expect(r.lines.every((l) => l.ok && l.subtotalDelta === "0.00")).toBe(true);
    expect(r.invoiceTotals).toEqual({ subtotal: "124.99", tax: "26.25", total: "151.24" });
  });

  it("quantity mismatch cites both lines and the exact delta", () => {
    const r = run(invoice({ declared: { subtotal: "127.49", tax: "26.78", total: "154.27" } }, [{ quantity: "11" }]));
    expect(r.status).toBe("REVIEW_REQUIRED");
    const f = r.findings.find((x) => x.ruleId === "LINE_QUANTITY_MISMATCH")!;
    expect(f).toMatchObject({
      invoiceRef: { field: "quantity", lineId: "1" },
      poRef: { field: "quantity", lineId: "P1" },
      actual: "11",
      expected: "10",
      delta: "1",
    });
    expect(r.findings.map((x) => x.ruleId).sort()).toEqual(["LINE_QUANTITY_MISMATCH", "TOTAL_VS_PO_MISMATCH"]);
    expect(r.findings.find((x) => x.ruleId === "TOTAL_VS_PO_MISMATCH")?.delta).toBe("3.03");
  });

  it("price differences of one cent are not tolerated", () => {
    const r = run(invoice({ declared: { subtotal: "125.09", tax: "26.27", total: "151.36" } }, [{ unitPrice: "2.51" }]));
    expect(ids(r)).toEqual(["LINE_UNIT_PRICE_MISMATCH", "TOTAL_VS_PO_MISMATCH"]);
    expect(r.findings[0]!.delta).toBe("0.01");
  });

  it("tax rate mismatch", () => {
    const r = run(invoice({ declared: { subtotal: "124.99", tax: "25.75", total: "150.74" } }, [{ taxRate: "0.19" }]));
    expect(ids(r)).toEqual(["LINE_TAX_RATE_MISMATCH", "TOTAL_VS_PO_MISMATCH"]);
  });

  it("inconsistent declared totals are flagged, never overwritten", () => {
    const r = run(invoice({ declared: { subtotal: "124.99", tax: "26.25", total: "160.00" } }));
    expect(ids(r)).toEqual(["INV_TOTAL_ARITHMETIC"]);
    expect(r.declaredTotals.total).toBe("160.00");
    expect(r.invoiceTotals.total).toBe("151.24");
    expect(r.findings[0]!.delta).toBe("8.76");
  });

  it("printed line subtotal mismatch", () => {
    expect(ids(run(invoice({}, [{ lineSubtotal: "24.00" }])))).toEqual(["INV_LINE_ARITHMETIC"]);
  });

  it("missing and extra lines", () => {
    const one = invoice({ declared: { subtotal: "25.00", tax: "5.25", total: "30.25" } });
    one.lines = one.lines.slice(0, 1);
    expect(ids(run(one))).toEqual(["LINE_MISSING_ON_INVOICE", "TOTAL_VS_PO_MISMATCH"]);
    const extra = invoice({ declared: { subtotal: "125.99", tax: "26.46", total: "152.45" } });
    extra.lines.push({ lineId: "3", sku: "ZZZ", description: "Freight", quantity: "1", unitPrice: "1.00", taxRate: "0.21" });
    expect(ids(run(extra))).toEqual(["LINE_UNMATCHED_INVOICE", "TOTAL_VS_PO_MISMATCH"]);
  });

  it("supplier, currency, closed PO and duplicate", () => {
    expect(ids(run(invoice({ supplierId: "sup-2" })))).toEqual(["SUPPLIER_MISMATCH"]);
    // Totals are not compared across currencies; no conversion is attempted.
    expect(ids(run(invoice({ currency: "USD" })))).toEqual(["CURRENCY_MISMATCH"]);
    expect(ids(run(invoice(), { ...po, status: "CLOSED" }))).toEqual(["PO_CLOSED"]);
    expect(ids(run(invoice(), po, ctx({ duplicateInvoiceIds: ["x"] })))).toEqual(["DUPLICATE_INVOICE"]);
  });

  it("no PO: UNMATCHED, ambiguous vs not found", () => {
    expect(run(invoice(), null, ctx({ candidateCount: 0, poSelection: "NONE" })).status).toBe("UNMATCHED");
    expect(ids(run(invoice(), null, ctx({ candidateCount: 0 })))).toEqual(["PO_NOT_FOUND"]);
    expect(ids(run(invoice(), null, ctx({ candidateCount: 2, agentConfidence: "LOW" })))).toEqual([
      "LOW_AGENT_CONFIDENCE",
      "PO_AMBIGUOUS",
    ]);
  });

  it("agent-selected PO and semantic mappings always require review, even at HIGH confidence", () => {
    const inv = invoice({ poReference: null }, [{ sku: null }, { sku: null }]);
    const r = reconcile(
      inv,
      po,
      [
        { invoiceLineId: "1", poLineId: "P1", basis: "SEMANTIC" },
        { invoiceLineId: "2", poLineId: "P2", basis: "SEMANTIC" },
      ],
      ctx({ poSelection: "AGENT", agentConfidence: "HIGH" }),
    );
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.findings.map((f) => f.ruleId).sort()).toEqual([
      "LINE_SEMANTIC_MAPPING",
      "LINE_SEMANTIC_MAPPING",
      "PO_SELECTED_BY_AGENT",
    ]);
  });

  it("an invoice PO reference different from the selected PO is flagged", () => {
    expect(ids(run(invoice({ poReference: "PO-OTHER" })))).toEqual(["PO_REFERENCE_MISMATCH"]);
  });

  it("rejects mappings with invented or reused IDs", () => {
    expect(() => reconcile(invoice(), po, [{ invoiceLineId: "1", poLineId: "NOPE", basis: "SEMANTIC" }], ctx())).toThrow(/unknown PO line/);
    expect(() => reconcile(invoice(), po, [{ invoiceLineId: "9", poLineId: "P1", basis: "SEMANTIC" }], ctx())).toThrow(/unknown invoice line/);
    expect(() =>
      reconcile(
        invoice(),
        po,
        [
          { invoiceLineId: "1", poLineId: "P1", basis: "SKU" },
          { invoiceLineId: "2", poLineId: "P1", basis: "SEMANTIC" },
        ],
        ctx(),
      ),
    ).toThrow(/more than once/);
  });

  it("SKU mapping is exact, case-insensitive and never maps ambiguous SKUs", () => {
    const line = { description: "", quantity: "1", unitPrice: "1", taxRate: "0" };
    expect(mapLinesBySku([{ lineId: "1", sku: "bbb", ...line }], po.lines)).toEqual([
      { invoiceLineId: "1", poLineId: "P2", basis: "SKU" },
    ]);
    const m = mapLinesBySku(
      [
        { lineId: "1", sku: "aaa", ...line },
        { lineId: "2", sku: null, ...line },
      ],
      [...po.lines, { ...po.lines[0]!, lineId: "P3" }],
    );
    expect(m).toEqual([
      { invoiceLineId: "1", poLineId: null, basis: null }, // two PO lines share SKU AAA
      { invoiceLineId: "2", poLineId: null, basis: null },
    ]);
  });
});
