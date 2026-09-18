import { describe, expect, it } from "vitest";
import { checkFiscalReadiness } from "./fiscal.js";

const complete = {
  id: "c1",
  displayName: "Taller Norte SA de CV",
  kind: "BUSINESS",
  rfc: "TNO950101AB1",
  legalName: "Taller Norte SA de CV",
  fiscalPostalCode: "64000",
  taxRegime: "601",
  email: "facturas@tallernorte.mx",
};

describe("checkFiscalReadiness", () => {
  it("passes a customer holding every field from the spec's minimum fiscal data", () => {
    expect(checkFiscalReadiness(complete)).toEqual({
      customerId: "c1",
      displayName: "Taller Norte SA de CV",
      ready: true,
      missing: [],
    });
  });

  it("lists every missing field rather than stopping at the first", () => {
    const result = checkFiscalReadiness({
      ...complete,
      rfc: null,
      legalName: null,
      fiscalPostalCode: null,
      taxRegime: null,
      email: null,
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["RFC", "Legal/fiscal name", "Fiscal postal code", "Tax regime", "Email"]);
  });

  it("rejects values that are present but malformed", () => {
    const result = checkFiscalReadiness({
      ...complete,
      rfc: "NOT-AN-RFC",
      fiscalPostalCode: "640",
      email: "facturas.tallernorte.mx",
    });

    expect(result.missing).toEqual(["RFC (malformed)", "Fiscal postal code (malformed)", "Email (malformed)"]);
  });

  it("accepts a persona fisica RFC (four leading letters)", () => {
    expect(checkFiscalReadiness({ ...complete, rfc: "GOAM850317H29" }).ready).toBe(true);
  });

  // Publico en general invoices through the factura global, so per-customer
  // fiscal data is not required (docs/mvp/04-core-domains.md).
  it("exempts publico en general from every fiscal field", () => {
    const result = checkFiscalReadiness({
      id: "c2",
      displayName: "Publico en general",
      kind: "PUBLICO_GENERAL",
      rfc: null,
      legalName: null,
      fiscalPostalCode: null,
      taxRegime: null,
      email: null,
    });

    expect(result).toEqual({ customerId: "c2", displayName: "Publico en general", ready: true, missing: [] });
  });
});
