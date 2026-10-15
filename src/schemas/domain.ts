import { z } from "zod";

/**
 * Zod contracts for synthetic invoice / purchase-order payloads.
 *
 * Money, quantities and tax rates travel as decimal strings ("12.50", "0.21") so that
 * no value ever passes through a binary floating-point number before reaching decimal.js.
 */

const DECIMAL_RE = /^\d{1,12}(\.\d{1,6})?$/;

/** Non-negative exact decimal written as a string. Rejects exponents, signs and NaN/Infinity. */
export const decimalString = z
  .string()
  .trim()
  .regex(DECIMAL_RE, "must be a non-negative decimal string such as \"12.50\"");

/** Strictly positive quantity. */
export const quantityString = decimalString.refine((v) => Number(v) > 0, "quantity must be > 0");

/** Tax rate as a fraction between 0 and 1 (e.g. "0.21" for 21%). */
export const taxRateString = decimalString.refine(
  (v) => Number(v) >= 0 && Number(v) <= 1,
  "tax rate must be a fraction between 0 and 1",
);

export const CURRENCIES = ["EUR", "USD", "GBP", "JPY"] as const;
export const currencyCode = z.enum(CURRENCIES);
export type CurrencyCode = z.infer<typeof currencyCode>;

const lineId = z.string().trim().min(1).max(64);
const sku = z.string().trim().min(1).max(64);

export const invoiceLineSchema = z.object({
  lineId,
  sku: sku.nullish(),
  description: z.string().trim().min(1).max(200),
  quantity: quantityString,
  unitPrice: decimalString,
  taxRate: taxRateString,
  /** Line subtotal as printed on the invoice; recomputed and compared, never trusted. */
  lineSubtotal: decimalString.nullish(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const invoicePayloadSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(64),
    supplierCode: z.string().trim().min(1).max(32),
    poReference: z.string().trim().min(1).max(64).nullish(),
    invoiceDate: z.iso.date(),
    currency: currencyCode,
    lines: z.array(invoiceLineSchema).min(1).max(50),
    declared: z.object({
      subtotal: decimalString,
      tax: decimalString,
      total: decimalString,
    }),
  })
  .superRefine((inv, ctx) => {
    const seen = new Set<string>();
    inv.lines.forEach((line, i) => {
      if (seen.has(line.lineId)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "lineId"],
          message: `duplicate lineId ${line.lineId}`,
        });
      }
      seen.add(line.lineId);
    });
  });
export type InvoicePayload = z.infer<typeof invoicePayloadSchema>;

export const purchaseOrderLineSchema = z.object({
  lineId,
  sku: sku.nullish(),
  description: z.string().trim().min(1).max(200),
  quantity: quantityString,
  unitPrice: decimalString,
  taxRate: taxRateString,
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderPayloadSchema = z.object({
  poNumber: z.string().trim().min(1).max(64),
  supplierCode: z.string().trim().min(1).max(32),
  currency: currencyCode,
  status: z.enum(["OPEN", "CLOSED"]),
  lines: z.array(purchaseOrderLineSchema).min(1).max(50),
});
export type PurchaseOrderPayload = z.infer<typeof purchaseOrderPayloadSchema>;

export const supplierSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  taxId: z.string().trim().max(32).nullish(),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

/** Statuses of a reconciliation. PROCESSING is the transient technical state while the run executes. */
export const RECONCILIATION_STATUSES = [
  "PROCESSING",
  "MATCHED",
  "REVIEW_REQUIRED",
  "UNMATCHED",
  "APPROVED_WITH_EXCEPTION",
  "REJECTED",
  "FAILED",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const reviewDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(5, "a reason of at least 5 characters is required").max(1000),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
