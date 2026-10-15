import { describe, expect, it } from "vitest";
import { dec, documentTotals, formatMoney, lineAmounts, roundMoney } from "@/domain/money";

describe("money", () => {
  it("rounds half-up to currency minor units", () => {
    expect(formatMoney(dec("75.516"), "EUR")).toBe("75.52");
    expect(formatMoney(dec("4.935"), "EUR")).toBe("4.94");
    expect(formatMoney(dec("11.115"), "EUR")).toBe("11.12"); // binary floats would give 11.11
    expect(formatMoney(dec("2.5"), "JPY")).toBe("3");
    expect(formatMoney(dec("0.004999"), "USD")).toBe("0.00");
  });

  it("has no floating point drift", () => {
    expect(dec("0.1").add(dec("0.2")).eq(dec("0.3"))).toBe(true);
    expect(roundMoney(dec("1.005"), "EUR").toFixed(2)).toBe("1.01");
  });

  it("rounds each line before summing (documented policy)", () => {
    const lines = [
      { quantity: "20", unitPrice: "4.50", taxRate: "0.21" },
      { quantity: "4", unitPrice: "89.90", taxRate: "0.21" },
      { quantity: "10", unitPrice: "2.35", taxRate: "0.21" },
    ];
    const t = documentTotals(lines, "EUR");
    expect([t.subtotal, t.tax, t.total].map((d) => formatMoney(d, "EUR"))).toEqual(["473.10", "99.36", "572.46"]);
    expect(formatMoney(lineAmounts(lines[1]!, "EUR").tax, "EUR")).toBe("75.52");
  });

  it("rejects non-finite input", () => {
    expect(() => dec("Infinity")).toThrow();
    expect(() => dec("NaN")).toThrow();
  });
});
