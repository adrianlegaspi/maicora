import { Decimal } from "decimal.js";

/**
 * All money values flow through this wrapper instead of raw `number`.
 * Floating point is not acceptable for pricing/tax/fiscal math (see
 * docs/mvp/06-pricing-and-costing.md and 14-non-negotiables-and-thesis.md:
 * "No pricing math delegated to the LLM" implies the deterministic engine
 * itself must be exact). Postgres `numeric` columns round-trip as strings,
 * which is exactly what Decimal.js consumes without precision loss.
 */
export class Money {
  private readonly amount: Decimal;
  readonly currency: string;

  private constructor(amount: Decimal, currency: string) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(value: Decimal.Value, currency = "MXN"): Money {
    return new Money(new Decimal(value), currency);
  }

  static zero(currency = "MXN"): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  mul(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  div(divisor: Decimal.Value): Money {
    return new Money(this.amount.dividedBy(divisor), this.currency);
  }

  /** Rounds to the currency's minor unit (2 decimals for MXN/USD). */
  round(decimalPlaces = 2): Money {
    return new Money(this.amount.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP), this.currency);
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount);
  }

  toDecimal(): Decimal {
    return this.amount;
  }

  /** Canonical string form for persistence into a `numeric` column. */
  toStorage(): string {
    return this.amount.toFixed(6);
  }

  /** Fixed-decimal string for display/comparison, e.g. toFixed(2) => "279.08". */
  toFixed(decimalPlaces = 2): string {
    return this.amount.toFixed(decimalPlaces);
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  format(): string {
    return `${this.currency} ${this.amount.toFixed(2)}`;
  }
}

export function percent(value: Decimal.Value): Decimal {
  return new Decimal(value).dividedBy(100);
}
