import { describe, expect, it } from "vitest";
import { idempotencyKey } from "./definitions.js";

describe("idempotencyKey", () => {
  it("is stable regardless of key order", () => {
    expect(idempotencyKey("invoices.prepare_invoice", { a: 1, b: [2, { c: 3, d: 4 }] })).toBe(
      idempotencyKey("invoices.prepare_invoice", { b: [{ d: 4, c: 3 }, 2].reverse(), a: 1 }),
    );
  });

  it("changes when the arguments change", () => {
    expect(idempotencyKey("x", { quantity: "10" })).not.toBe(idempotencyKey("x", { quantity: "11" }));
  });

  it("changes when the capability changes", () => {
    expect(idempotencyKey("a", { id: 1 })).not.toBe(idempotencyKey("b", { id: 1 }));
  });

  it("ignores undefined fields, so an omitted optional matches an explicit undefined", () => {
    expect(idempotencyKey("x", { id: 1, note: undefined })).toBe(idempotencyKey("x", { id: 1 }));
  });
});
