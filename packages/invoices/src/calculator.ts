import { Money } from "@maicora/shared";
import type { InvoiceTotals } from "./types.js";

/**
 * Deterministic invoice arithmetic (docs/mvp/07-invoicing-cfdi.md). Like the
 * pricing calculator, the agent never computes these numbers: it calls the
 * invoice capability and narrates what comes back.
 *
 * Rounding happens per line, because that is what ends up on the CFDI and
 * what the SAT validates the document totals against.
 */
export interface LineAmounts {
  base: string;
  taxAmount: string;
  total: string;
}

export function calculateLine(
  line: { quantity: string; unitPrice: string; discount?: string; taxRate: string },
  currency = "MXN",
): LineAmounts {
  const gross = Money.of(line.unitPrice, currency).mul(line.quantity);
  const base = gross.sub(Money.of(line.discount ?? "0", currency)).round();
  const taxAmount = base.mul(line.taxRate).round();

  return {
    base: base.toStorage(),
    taxAmount: taxAmount.toStorage(),
    total: base.add(taxAmount).toStorage(),
  };
}

export function calculateTotals(lines: LineAmounts[], currency = "MXN"): InvoiceTotals {
  const subtotal = lines.reduce((sum, l) => sum.add(Money.of(l.base, currency)), Money.zero(currency));
  const taxTotal = lines.reduce((sum, l) => sum.add(Money.of(l.taxAmount, currency)), Money.zero(currency));

  return {
    subtotal: subtotal.toStorage(),
    taxTotal: taxTotal.toStorage(),
    total: subtotal.add(taxTotal).toStorage(),
  };
}
