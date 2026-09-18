export type CustomerKind = "BUSINESS" | "INDIVIDUAL" | "PUBLICO_GENERAL";

/** Fields a create proposal carries. `displayName` is the only hard requirement. */
export interface CustomerInput {
  displayName: string;
  kind?: CustomerKind;
  branchId?: string | null;
  legalName?: string | null;
  rfc?: string | null;
  taxRegime?: string | null;
  fiscalPostalCode?: string | null;
  cfdiUseDefault?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
}

/** Every field is optional: an update proposal only carries what changes. */
export type CustomerPatch = Partial<CustomerInput>;

export interface CustomerSearchParams {
  /** Matched against display name, legal name, RFC and email. */
  query?: string;
  kind?: CustomerKind;
  tag?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Result of the deterministic fiscal validation the agent must run before
 * preparing an invoice (docs/mvp/04-core-domains.md).
 */
export interface FiscalReadiness {
  customerId: string;
  displayName: string;
  ready: boolean;
  /** Field labels, in the spec's order, that block invoicing this customer. */
  missing: string[];
}
