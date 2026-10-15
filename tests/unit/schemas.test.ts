import { describe, expect, it } from "vitest";
import { invoicePayloadSchema, reviewDecisionSchema } from "@/schemas/domain";

const base = {
  invoiceNumber: "INV-T-1",
  supplierCode: "SUP-ACME",
  poReference: "PO-1001",
  invoiceDate: "2026-10-01",
  currency: "EUR",
  lines: [
    { lineId: "1", sku: "A", description: "a", quantity: "1", unitPrice: "1.00", taxRate: "0.21" },
    { lineId: "2", sku: "B", description: "b", quantity: "2", unitPrice: "1.00", taxRate: "0.21" },
  ],
  declared: { subtotal: "3.00", tax: "0.63", total: "3.63" },
};
const withLine = (patch: Record<string, unknown>) => ({ ...base, lines: [{ ...base.lines[0], ...patch }, base.lines[1]] });

describe("invoice payload schema", () => {
  it("accepts a valid invoice", () => {
    expect(invoicePayloadSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ["negative price", { unitPrice: "-1.00" }],
    ["exponent notation", { unitPrice: "1e3" }],
    ["NaN", { unitPrice: "NaN" }],
    ["Infinity", { quantity: "Infinity" }],
    ["zero quantity", { quantity: "0" }],
    ["number instead of string", { unitPrice: 1.5 }],
    ["tax rate above 1", { taxRate: "21" }],
    ["too many decimals", { unitPrice: "1.1234567" }],
  ])("rejects %s", (_name, patch) => {
    expect(invoicePayloadSchema.safeParse(withLine(patch)).success).toBe(false);
  });

  it("rejects duplicate line ids", () => {
    const dup = { ...base, lines: [base.lines[0], { ...base.lines[1], lineId: "1" }] };
    expect(invoicePayloadSchema.safeParse(dup).success).toBe(false);
  });

  it("rejects unknown currency and impossible dates", () => {
    expect(invoicePayloadSchema.safeParse({ ...base, currency: "BTC" }).success).toBe(false);
    expect(invoicePayloadSchema.safeParse({ ...base, invoiceDate: "2026-13-40" }).success).toBe(false);
  });
});

describe("review decision schema", () => {
  it("requires a decision, a reason and an idempotency key", () => {
    expect(reviewDecisionSchema.safeParse({ decision: "APPROVE", reason: "", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ decision: "APPROVE", reason: "price agreed", idempotencyKey: "abc" }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ decision: "PAY", reason: "price agreed", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ decision: "REJECT", reason: "wrong price", idempotencyKey: "abcdefgh" }).success).toBe(true);
  });
});
