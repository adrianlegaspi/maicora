import { Decimal } from "decimal.js";
import { Money } from "@maicora/shared";
import type { CostComponentInput, ScenarioInput, ScenarioResult } from "./types.js";

/**
 * Pure, deterministic pricing math (docs/mvp/06-pricing-and-costing.md).
 * Non-negotiable #11: "No pricing math delegated to the LLM." The agent
 * calls these functions through the pricing capability and only ever
 * narrates their output; it never computes or overrides a number itself.
 *
 * All functions round only at the boundary (the final returned Money), so
 * chained calculations do not accumulate rounding error.
 */

// Takes only `amount` so both draft inputs and persisted cost model
// components (whose optional fields are nullable) can be summed as-is.
export function calculateTrueCost(components: Pick<CostComponentInput, "amount">[], currency = "MXN"): Money {
  return components
    .reduce((sum, c) => sum.add(Money.of(c.amount, currency)), Money.zero(currency))
    .round();
}

/** The price at which margin is exactly zero: identical to true cost, pre-tax. */
export function calculateBreakEvenPrice(trueCost: Money): Money {
  return trueCost.round();
}

/** (price - cost) / cost. Markup is expressed relative to cost. */
export function calculateMarkup(trueCost: Money, salePrice: Money): Decimal {
  if (trueCost.isZero()) {
    throw new Error("Cannot calculate markup against a zero cost");
  }
  return salePrice.sub(trueCost).toDecimal().dividedBy(trueCost.toDecimal());
}

/** (price - cost) / price. Gross margin is expressed relative to price. */
export function calculateGrossMargin(trueCost: Money, salePrice: Money): Decimal {
  if (salePrice.isZero()) {
    throw new Error("Cannot calculate gross margin against a zero sale price");
  }
  return salePrice.sub(trueCost).toDecimal().dividedBy(salePrice.toDecimal());
}

export function calculateProfitPerUnit(trueCost: Money, salePrice: Money): Money {
  return salePrice.sub(trueCost).round();
}

/**
 * Solves price for a target gross margin: price = cost / (1 - targetMargin).
 * targetMargin is a fraction (0.35 for 35%), and must be < 1.
 */
export function calculateTargetPrice(trueCost: Money, targetMargin: Decimal.Value): Money {
  const margin = new Decimal(targetMargin);
  if (margin.greaterThanOrEqualTo(1) || margin.lessThan(0)) {
    throw new Error(`targetMargin must be in [0, 1); got ${margin.toString()}`);
  }
  const denominator = new Decimal(1).minus(margin);
  return trueCost.div(denominator).round();
}

export function compareScenarios(trueCost: Money, scenarios: ScenarioInput[]): ScenarioResult[] {
  return scenarios.map((scenario) => {
    const price = Money.of(scenario.salePrice, trueCost.currency).round();
    return {
      label: scenario.label,
      salePrice: price.toStorage(),
      markup: calculateMarkup(trueCost, price).toFixed(4),
      grossMargin: calculateGrossMargin(trueCost, price).toFixed(4),
      profitPerUnit: calculateProfitPerUnit(trueCost, price).toStorage(),
    };
  });
}
