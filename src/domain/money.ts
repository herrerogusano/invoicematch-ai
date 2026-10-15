import Decimal from "decimal.js";
import type { CurrencyCode } from "@/schemas/domain";

/**
 * Exact money helpers. Rounding policy (documented in docs/architecture.md):
 *
 * - line subtotal = round(quantity × unitPrice)
 * - line tax      = round(line subtotal × taxRate)
 * - subtotal      = Σ line subtotals
 * - tax           = Σ line taxes
 * - total         = subtotal + tax
 *
 * where round() is ROUND_HALF_UP to the currency's minor-unit precision. Comparisons are made
 * on rounded Decimals with zero tolerance; no JavaScript number arithmetic is ever used for money.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const MINOR_UNITS: Record<CurrencyCode, number> = { EUR: 2, USD: 2, GBP: 2, JPY: 0 };

export function dec(value: string | Dec): Dec {
  const d = new D(value);
  if (!d.isFinite()) throw new Error(`non-finite decimal: ${String(value)}`);
  return d;
}

export function roundMoney(value: Dec, currency: CurrencyCode): Dec {
  return value.toDecimalPlaces(MINOR_UNITS[currency], D.ROUND_HALF_UP);
}

/** Canonical string with exactly the currency's minor digits, e.g. "12.50". */
export function formatMoney(value: Dec, currency: CurrencyCode): string {
  return roundMoney(value, currency).toFixed(MINOR_UNITS[currency]);
}

/** Canonical decimal string without trailing zeros (for quantities and rates). */
export function formatDecimal(value: Dec): string {
  return value.toFixed();
}

export interface PricedLine {
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

export interface LineAmounts {
  subtotal: Dec;
  tax: Dec;
}

export function lineAmounts(line: PricedLine, currency: CurrencyCode): LineAmounts {
  const subtotal = roundMoney(dec(line.quantity).mul(dec(line.unitPrice)), currency);
  const tax = roundMoney(subtotal.mul(dec(line.taxRate)), currency);
  return { subtotal, tax };
}

export interface Totals {
  subtotal: Dec;
  tax: Dec;
  total: Dec;
}

export function documentTotals(lines: PricedLine[], currency: CurrencyCode): Totals {
  let subtotal = dec("0");
  let tax = dec("0");
  for (const line of lines) {
    const a = lineAmounts(line, currency);
    subtotal = subtotal.add(a.subtotal);
    tax = tax.add(a.tax);
  }
  return { subtotal, tax, total: subtotal.add(tax) };
}

export function totalsToStrings(t: Totals, currency: CurrencyCode) {
  return {
    subtotal: formatMoney(t.subtotal, currency),
    tax: formatMoney(t.tax, currency),
    total: formatMoney(t.total, currency),
  };
}
