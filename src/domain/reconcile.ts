import type { CurrencyCode } from "@/schemas/domain";
import {
  dec,
  documentTotals,
  formatDecimal,
  formatMoney,
  lineAmounts,
  roundMoney,
  totalsToStrings,
} from "./money";

/**
 * Pure, deterministic reconciliation of one invoice against (at most) one purchase order.
 *
 * The agent may propose which PO to use and how invoice lines correspond to PO lines. Everything
 * monetary and every pass/fail decision is made here. Agent output can only add findings (e.g. a
 * semantic mapping needs review); it can never remove one.
 */

export type Severity = "ERROR" | "WARNING" | "INFO";

export const RULES = {
  INV_LINE_ARITHMETIC: "Printed invoice line subtotal differs from quantity × unit price",
  INV_SUBTOTAL_ARITHMETIC: "Declared invoice subtotal differs from the sum of line subtotals",
  INV_TAX_ARITHMETIC: "Declared invoice tax differs from the recomputed tax",
  INV_TOTAL_ARITHMETIC: "Declared invoice total differs from recomputed subtotal + tax",
  DUPLICATE_INVOICE: "Another invoice with the same number exists for this supplier",
  PO_NOT_FOUND: "No purchase order could be associated with the invoice",
  PO_AMBIGUOUS: "Several purchase orders are plausible and none was selected with certainty",
  PO_SELECTED_BY_AGENT: "Purchase order was selected by the agent, not by an explicit reference",
  PO_REFERENCE_MISMATCH: "Invoice PO reference differs from the selected purchase order",
  SUPPLIER_MISMATCH: "Invoice supplier differs from the purchase order supplier",
  CURRENCY_MISMATCH: "Invoice currency differs from the purchase order currency",
  PO_CLOSED: "Purchase order is closed",
  LINE_UNMATCHED_INVOICE: "Invoice line has no corresponding purchase order line",
  LINE_MISSING_ON_INVOICE: "Purchase order line is not present on the invoice",
  LINE_SEMANTIC_MAPPING: "Line correspondence is semantic (agent-proposed), not an exact SKU match",
  LINE_SKU_MISMATCH: "Mapped lines carry different SKUs",
  LINE_QUANTITY_MISMATCH: "Invoiced quantity differs from ordered quantity",
  LINE_UNIT_PRICE_MISMATCH: "Invoiced unit price differs from ordered unit price",
  LINE_TAX_RATE_MISMATCH: "Invoiced tax rate differs from ordered tax rate",
  TOTAL_VS_PO_MISMATCH: "Recomputed invoice total differs from the purchase order total",
  LOW_AGENT_CONFIDENCE: "Agent reported low confidence in its selection or mapping",
} as const;
export type RuleId = keyof typeof RULES;

export interface FieldRef {
  field: string;
  lineId?: string;
}

export interface RuleFinding {
  ruleId: RuleId;
  severity: Severity;
  message: string;
  invoiceRef: FieldRef | null;
  poRef: FieldRef | null;
  actual: string | null;
  expected: string | null;
  /** actual − expected, exact, when both are numeric. */
  delta: string | null;
}

export interface DomainLine {
  lineId: string;
  sku?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

export interface DomainInvoice {
  invoiceNumber: string;
  supplierId: string;
  poReference?: string | null;
  currency: CurrencyCode;
  lines: Array<DomainLine & { lineSubtotal?: string | null }>;
  declared: { subtotal: string; tax: string; total: string };
}

export interface DomainPurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  currency: CurrencyCode;
  status: "OPEN" | "CLOSED";
  lines: DomainLine[];
}

export type MappingBasis = "SKU" | "SEMANTIC";

export interface LineMapping {
  invoiceLineId: string;
  poLineId: string | null;
  basis: MappingBasis | null;
}

export type PoSelection = "REFERENCE" | "AGENT" | "NONE";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface ReconcileContext {
  /** IDs of previously stored invoices with the same supplier + invoice number. */
  duplicateInvoiceIds: string[];
  poSelection: PoSelection;
  /** Number of plausible PO candidates considered (0 when none existed). */
  candidateCount: number;
  agentConfidence: Confidence | null;
}

export interface LineComparison {
  invoiceLineId: string | null;
  poLineId: string | null;
  basis: MappingBasis | null;
  invoice: { sku: string | null; description: string; quantity: string; unitPrice: string; taxRate: string; subtotal: string } | null;
  po: { sku: string | null; description: string; quantity: string; unitPrice: string; taxRate: string; subtotal: string } | null;
  /** invoice subtotal − PO subtotal for this pair (null when one side is missing). */
  subtotalDelta: string | null;
  ok: boolean;
}

export type AutomaticStatus = "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";

export interface ReconcileResult {
  status: AutomaticStatus;
  findings: RuleFinding[];
  lines: LineComparison[];
  invoiceTotals: { subtotal: string; tax: string; total: string };
  declaredTotals: { subtotal: string; tax: string; total: string };
  poTotals: { subtotal: string; tax: string; total: string } | null;
}

function finding(
  ruleId: RuleId,
  severity: Severity,
  refs: { invoiceRef?: FieldRef | null; poRef?: FieldRef | null },
  values: { actual?: string | null; expected?: string | null; delta?: string | null } = {},
): RuleFinding {
  return {
    ruleId,
    severity,
    message: RULES[ruleId],
    invoiceRef: refs.invoiceRef ?? null,
    poRef: refs.poRef ?? null,
    actual: values.actual ?? null,
    expected: values.expected ?? null,
    delta: values.delta ?? null,
  };
}

function normaliseSku(sku: string | null | undefined): string | null {
  const s = sku?.trim().toUpperCase();
  return s ? s : null;
}

/**
 * Deterministic SKU mapping: an invoice line maps to a PO line only when exactly one unused PO line
 * has the same (case-insensitive) SKU. Everything else is left unresolved for the agent or review.
 */
export function mapLinesBySku(invoiceLines: DomainLine[], poLines: DomainLine[]): LineMapping[] {
  const used = new Set<string>();
  return invoiceLines.map((il) => {
    const sku = normaliseSku(il.sku);
    if (!sku) return { invoiceLineId: il.lineId, poLineId: null, basis: null };
    const matches = poLines.filter((pl) => normaliseSku(pl.sku) === sku && !used.has(pl.lineId));
    if (matches.length !== 1) return { invoiceLineId: il.lineId, poLineId: null, basis: null };
    const target = matches[0]!;
    used.add(target.lineId);
    return { invoiceLineId: il.lineId, poLineId: target.lineId, basis: "SKU" };
  });
}

/** Validates the internal arithmetic of the invoice itself, independently of any PO. */
function invoiceArithmeticFindings(invoice: DomainInvoice): RuleFinding[] {
  const out: RuleFinding[] = [];
  const c = invoice.currency;
  for (const line of invoice.lines) {
    if (line.lineSubtotal == null) continue;
    const printed = roundMoney(dec(line.lineSubtotal), c);
    const computed = lineAmounts(line, c).subtotal;
    if (!printed.eq(computed)) {
      out.push(
        finding(
          "INV_LINE_ARITHMETIC",
          "ERROR",
          { invoiceRef: { field: "lineSubtotal", lineId: line.lineId } },
          {
            actual: formatMoney(printed, c),
            expected: formatMoney(computed, c),
            delta: formatMoney(printed.sub(computed), c),
          },
        ),
      );
    }
  }
  const t = documentTotals(invoice.lines, c);
  const checks: Array<[RuleId, "subtotal" | "tax" | "total"]> = [
    ["INV_SUBTOTAL_ARITHMETIC", "subtotal"],
    ["INV_TAX_ARITHMETIC", "tax"],
    ["INV_TOTAL_ARITHMETIC", "total"],
  ];
  for (const [ruleId, key] of checks) {
    const declared = roundMoney(dec(invoice.declared[key]), c);
    if (!declared.eq(t[key])) {
      out.push(
        finding(
          ruleId,
          "ERROR",
          { invoiceRef: { field: `declared.${key}` } },
          {
            actual: formatMoney(declared, c),
            expected: formatMoney(t[key], c),
            delta: formatMoney(declared.sub(t[key]), c),
          },
        ),
      );
    }
  }
  return out;
}

function lineView(line: DomainLine, currency: CurrencyCode) {
  return {
    sku: line.sku ?? null,
    description: line.description,
    quantity: formatDecimal(dec(line.quantity)),
    unitPrice: formatDecimal(dec(line.unitPrice)),
    taxRate: formatDecimal(dec(line.taxRate)),
    subtotal: formatMoney(lineAmounts(line, currency).subtotal, currency),
  };
}

export function reconcile(
  invoice: DomainInvoice,
  po: DomainPurchaseOrder | null,
  mapping: LineMapping[],
  context: ReconcileContext,
): ReconcileResult {
  const c = invoice.currency;
  const findings: RuleFinding[] = [];
  const invoiceTotals = totalsToStrings(documentTotals(invoice.lines, c), c);
  const declaredTotals = {
    subtotal: formatMoney(dec(invoice.declared.subtotal), c),
    tax: formatMoney(dec(invoice.declared.tax), c),
    total: formatMoney(dec(invoice.declared.total), c),
  };

  findings.push(...invoiceArithmeticFindings(invoice));

  if (context.duplicateInvoiceIds.length > 0) {
    findings.push(
      finding(
        "DUPLICATE_INVOICE",
        "ERROR",
        { invoiceRef: { field: "invoiceNumber" } },
        { actual: invoice.invoiceNumber, expected: `previous invoice ids: ${context.duplicateInvoiceIds.join(", ")}` },
      ),
    );
  }

  if (context.agentConfidence === "LOW") {
    findings.push(finding("LOW_AGENT_CONFIDENCE", "WARNING", {}, { actual: "LOW" }));
  }

  if (!po) {
    findings.push(
      context.candidateCount > 1
        ? finding(
            "PO_AMBIGUOUS",
            "ERROR",
            { invoiceRef: { field: "poReference" } },
            { actual: invoice.poReference ?? null, expected: `${context.candidateCount} plausible candidates` },
          )
        : finding(
            "PO_NOT_FOUND",
            "ERROR",
            { invoiceRef: { field: "poReference" } },
            { actual: invoice.poReference ?? null },
          ),
    );
    return {
      status: "UNMATCHED",
      findings,
      lines: invoice.lines.map((il) => ({
        invoiceLineId: il.lineId,
        poLineId: null,
        basis: null,
        invoice: lineView(il, c),
        po: null,
        subtotalDelta: null,
        ok: false,
      })),
      invoiceTotals,
      declaredTotals,
      poTotals: null,
    };
  }

  const poCurrency = po.currency;
  const poTotals = totalsToStrings(documentTotals(po.lines, poCurrency), poCurrency);

  if (context.poSelection === "AGENT") {
    findings.push(
      finding("PO_SELECTED_BY_AGENT", "WARNING", { invoiceRef: { field: "poReference" }, poRef: { field: "poNumber" } }, {
        actual: invoice.poReference ?? null,
        expected: po.poNumber,
      }),
    );
  }
  if (invoice.poReference && invoice.poReference.trim().toUpperCase() !== po.poNumber.trim().toUpperCase()) {
    findings.push(
      finding(
        "PO_REFERENCE_MISMATCH",
        "ERROR",
        { invoiceRef: { field: "poReference" }, poRef: { field: "poNumber" } },
        { actual: invoice.poReference, expected: po.poNumber },
      ),
    );
  }
  if (invoice.supplierId !== po.supplierId) {
    findings.push(
      finding(
        "SUPPLIER_MISMATCH",
        "ERROR",
        { invoiceRef: { field: "supplier" }, poRef: { field: "supplier" } },
        { actual: invoice.supplierId, expected: po.supplierId },
      ),
    );
  }
  const sameCurrency = invoice.currency === po.currency;
  if (!sameCurrency) {
    findings.push(
      finding(
        "CURRENCY_MISMATCH",
        "ERROR",
        { invoiceRef: { field: "currency" }, poRef: { field: "currency" } },
        { actual: invoice.currency, expected: po.currency },
      ),
    );
  }
  if (po.status === "CLOSED") {
    findings.push(finding("PO_CLOSED", "ERROR", { poRef: { field: "status" } }, { actual: "CLOSED", expected: "OPEN" }));
  }

  // Validate the mapping itself: unknown IDs or double use of a PO line are programming/agent errors
  // and must never be silently accepted.
  const invoiceById = new Map(invoice.lines.map((l) => [l.lineId, l]));
  const poById = new Map(po.lines.map((l) => [l.lineId, l]));
  const mapped = new Map<string, LineMapping>();
  const usedPo = new Set<string>();
  for (const m of mapping) {
    if (!invoiceById.has(m.invoiceLineId)) throw new Error(`mapping references unknown invoice line ${m.invoiceLineId}`);
    if (m.poLineId !== null) {
      if (!poById.has(m.poLineId)) throw new Error(`mapping references unknown PO line ${m.poLineId}`);
      if (usedPo.has(m.poLineId)) throw new Error(`PO line ${m.poLineId} mapped more than once`);
      usedPo.add(m.poLineId);
    }
    mapped.set(m.invoiceLineId, m);
  }

  const lines: LineComparison[] = [];
  for (const il of invoice.lines) {
    const m = mapped.get(il.lineId);
    const pl = m?.poLineId ? poById.get(m.poLineId) : undefined;
    if (!m || !pl) {
      findings.push(
        finding("LINE_UNMATCHED_INVOICE", "ERROR", { invoiceRef: { field: "line", lineId: il.lineId } }, {
          actual: lineView(il, c).subtotal,
        }),
      );
      lines.push({ invoiceLineId: il.lineId, poLineId: null, basis: null, invoice: lineView(il, c), po: null, subtotalDelta: null, ok: false });
      continue;
    }
    const before = findings.length;
    const iRef = (field: string) => ({ field, lineId: il.lineId });
    const pRef = (field: string) => ({ field, lineId: pl.lineId });

    if (m.basis === "SEMANTIC") {
      findings.push(finding("LINE_SEMANTIC_MAPPING", "WARNING", { invoiceRef: iRef("description"), poRef: pRef("description") }, {
        actual: il.description,
        expected: pl.description,
      }));
    }
    const iSku = normaliseSku(il.sku);
    const pSku = normaliseSku(pl.sku);
    if (iSku && pSku && iSku !== pSku) {
      findings.push(finding("LINE_SKU_MISMATCH", "ERROR", { invoiceRef: iRef("sku"), poRef: pRef("sku") }, { actual: iSku, expected: pSku }));
    }
    const iq = dec(il.quantity);
    const pq = dec(pl.quantity);
    if (!iq.eq(pq)) {
      findings.push(finding("LINE_QUANTITY_MISMATCH", "ERROR", { invoiceRef: iRef("quantity"), poRef: pRef("quantity") }, {
        actual: formatDecimal(iq),
        expected: formatDecimal(pq),
        delta: formatDecimal(iq.sub(pq)),
      }));
    }
    const ip = dec(il.unitPrice);
    const pp = dec(pl.unitPrice);
    if (!ip.eq(pp)) {
      findings.push(finding("LINE_UNIT_PRICE_MISMATCH", "ERROR", { invoiceRef: iRef("unitPrice"), poRef: pRef("unitPrice") }, {
        actual: formatDecimal(ip),
        expected: formatDecimal(pp),
        delta: formatDecimal(ip.sub(pp)),
      }));
    }
    const it = dec(il.taxRate);
    const pt = dec(pl.taxRate);
    if (!it.eq(pt)) {
      findings.push(finding("LINE_TAX_RATE_MISMATCH", "ERROR", { invoiceRef: iRef("taxRate"), poRef: pRef("taxRate") }, {
        actual: formatDecimal(it),
        expected: formatDecimal(pt),
        delta: formatDecimal(it.sub(pt)),
      }));
    }
    const iv = lineView(il, c);
    const pv = lineView(pl, po.currency);
    lines.push({
      invoiceLineId: il.lineId,
      poLineId: pl.lineId,
      basis: m.basis,
      invoice: iv,
      po: pv,
      subtotalDelta: sameCurrency ? formatMoney(dec(iv.subtotal).sub(dec(pv.subtotal)), c) : null,
      ok: findings.length === before,
    });
  }

  for (const pl of po.lines) {
    if (usedPo.has(pl.lineId)) continue;
    findings.push(
      finding("LINE_MISSING_ON_INVOICE", "WARNING", { poRef: { field: "line", lineId: pl.lineId } }, {
        expected: lineView(pl, po.currency).subtotal,
      }),
    );
    lines.push({ invoiceLineId: null, poLineId: pl.lineId, basis: null, invoice: null, po: lineView(pl, po.currency), subtotalDelta: null, ok: false });
  }

  if (sameCurrency) {
    const it = dec(invoiceTotals.total);
    const pt = dec(poTotals.total);
    if (!it.eq(pt)) {
      findings.push(
        finding("TOTAL_VS_PO_MISMATCH", "ERROR", { invoiceRef: { field: "total" }, poRef: { field: "total" } }, {
          actual: invoiceTotals.total,
          expected: poTotals.total,
          delta: formatMoney(it.sub(pt), c),
        }),
      );
    }
  }

  const blocking = findings.some((f) => f.severity !== "INFO");
  return {
    status: blocking ? "REVIEW_REQUIRED" : "MATCHED",
    findings,
    lines,
    invoiceTotals,
    declaredTotals,
    poTotals,
  };
}
