import { describe, expect, it } from "vitest";
import { Money } from "@maicora/shared";
import {
  calculateBreakEvenPrice,
  calculateGrossMargin,
  calculateMarkup,
  calculateProfitPerUnit,
  calculateTargetPrice,
  calculateTrueCost,
  compareScenarios,
} from "./calculator.js";
import type { CostComponentInput } from "./types.js";

describe("calculateTrueCost", () => {
  it("sums resale cost components (docs/mvp/06 resale pattern)", () => {
    const components: CostComponentInput[] = [
      { type: "PURCHASE_COST", label: "Purchase", amount: "100" },
      { type: "FREIGHT", label: "Freight", amount: "12.50" },
      { type: "OTHER", label: "Handling", amount: "5" },
      { type: "FIXED_OVERHEAD", label: "Overhead", amount: "8.90" },
    ];
    expect(calculateTrueCost(components).toFixed(2)).toBe("126.40");
  });
});

describe("Figure Dragon XL golden example (docs/mvp/09-proposals-and-governance.md)", () => {
  // Spec: cost 181.40, current price 230.00, current margin 21.1%,
  // target margin 35% -> recommended price 279.08.
  const trueCost = Money.of("181.40");

  it("break-even price equals true cost", () => {
    expect(calculateBreakEvenPrice(trueCost).toFixed(2)).toBe("181.40");
  });

  it("matches the spec's current margin at the current sale price", () => {
    const currentPrice = Money.of("230.00");
    const margin = calculateGrossMargin(trueCost, currentPrice);
    expect(margin.toDecimalPlaces(3).toNumber()).toBeCloseTo(0.211, 3);
  });

  it("matches the spec's recommended price for a 35% target margin", () => {
    const recommended = calculateTargetPrice(trueCost, "0.35");
    expect(recommended.toFixed(2)).toBe("279.08");
  });

  it("rejects a target margin of 100% or more (undefined price)", () => {
    expect(() => calculateTargetPrice(trueCost, "1")).toThrow();
  });
});

describe("calculateMarkup vs calculateGrossMargin", () => {
  const cost = Money.of("100");
  const price = Money.of("150");

  it("markup is relative to cost", () => {
    expect(calculateMarkup(cost, price).toFixed(4)).toBe("0.5000");
  });

  it("gross margin is relative to price", () => {
    expect(calculateGrossMargin(cost, price).toFixed(4)).toBe("0.3333");
  });

  it("profit per unit is price minus cost", () => {
    expect(calculateProfitPerUnit(cost, price).toFixed(2)).toBe("50.00");
  });
});

describe("compareScenarios", () => {
  it("returns markup, margin and profit for each candidate price", () => {
    const cost = Money.of("100");
    const results = compareScenarios(cost, [
      { label: "Conservative", salePrice: "120" },
      { label: "Aggressive", salePrice: "160" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ label: "Conservative" });
    expect(Number(results[0]!.grossMargin)).toBeCloseTo((120 - 100) / 120, 4);
    expect(Number(results[1]!.grossMargin)).toBeCloseTo((160 - 100) / 160, 4);
  });
});
