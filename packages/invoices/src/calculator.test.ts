import { describe, expect, it } from "vitest";
import { calculateLine, calculateTotals } from "./calculator.js";

describe("invoice calculator", () => {
  it("reproduces the worked example from docs/mvp/09-proposals-and-governance.md", () => {
    const lines = [
      calculateLine({ quantity: "10", unitPrice: "600", taxRate: "0.16" }),
      calculateLine({ quantity: "4", unitPrice: "600", taxRate: "0.16" }),
    ];
    const totals = calculateTotals(lines);

    expect(totals.subtotal).toBe("8400.000000");
    expect(totals.taxTotal).toBe("1344.000000");
    expect(totals.total).toBe("9744.000000");
  });

  it("applies the discount before tax", () => {
    const line = calculateLine({ quantity: "2", unitPrice: "100", discount: "50", taxRate: "0.16" });

    expect(line.base).toBe("150.000000");
    expect(line.taxAmount).toBe("24.000000");
    expect(line.total).toBe("174.000000");
  });

  it("rounds each line to the minor unit so the document total matches the sum the SAT validates", () => {
    // 3 x 33.333 = 99.999 -> 100.00 at the line, not carried at full precision.
    const line = calculateLine({ quantity: "3", unitPrice: "33.333", taxRate: "0.16" });

    expect(line.base).toBe("100.000000");
    expect(line.taxAmount).toBe("16.000000");
    expect(calculateTotals([line]).total).toBe("116.000000");
  });

  it("charges no tax on an exempt line", () => {
    const line = calculateLine({ quantity: "1", unitPrice: "500", taxRate: "0" });

    expect(line.taxAmount).toBe("0.000000");
    expect(line.total).toBe("500.000000");
  });
});
