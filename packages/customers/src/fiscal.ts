import type { FiscalReadiness } from "./types.js";

/**
 * SAT RFC shape: 3 letters for a persona moral, 4 for a persona fisica,
 * then YYMMDD and a 3-character homoclave.
 */
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const POSTAL_CODE_PATTERN = /^\d{5}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The generic RFC the SAT reserves for "publico en general" receipts. */
export const RFC_PUBLICO_GENERAL = "XAXX010101000";

interface FiscalFields {
  id: string;
  displayName: string;
  kind: string;
  rfc: string | null;
  legalName: string | null;
  fiscalPostalCode: string | null;
  taxRegime: string | null;
  email: string | null;
}

/**
 * Deterministic validation of the minimum fiscal data from
 * docs/mvp/04-core-domains.md. The agent calls this and narrates the result;
 * it never decides on its own whether a customer can be invoiced.
 *
 * `cfdiUseDefault` is deliberately not required: it is a convenience default,
 * and every invoice supplies its own CFDI use, so its absence blocks nothing.
 */
export function checkFiscalReadiness(customer: FiscalFields): FiscalReadiness {
  const missing: string[] = [];

  // A "publico en general" customer invoices through the factura global under
  // the generic RFC, so none of the per-customer fiscal fields apply.
  if (customer.kind !== "PUBLICO_GENERAL") {
    if (!customer.rfc) missing.push("RFC");
    else if (!RFC_PATTERN.test(customer.rfc)) missing.push("RFC (malformed)");

    if (!customer.legalName) missing.push("Legal/fiscal name");

    if (!customer.fiscalPostalCode) missing.push("Fiscal postal code");
    else if (!POSTAL_CODE_PATTERN.test(customer.fiscalPostalCode)) missing.push("Fiscal postal code (malformed)");

    if (!customer.taxRegime) missing.push("Tax regime");

    if (!customer.email) missing.push("Email");
    else if (!EMAIL_PATTERN.test(customer.email)) missing.push("Email (malformed)");
  }

  return {
    customerId: customer.id,
    displayName: customer.displayName,
    ready: missing.length === 0,
    missing,
  };
}
