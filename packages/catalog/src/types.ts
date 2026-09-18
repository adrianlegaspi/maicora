export type ProductKind = "PRODUCT" | "SERVICE";

/** The minimum product model from docs/mvp/04-core-domains.md. */
export interface ProductInput {
  sku: string;
  name: string;
  kind?: ProductKind;
  description?: string | null;
  isActive?: boolean;
  salePrice?: string;
  currency?: string;
  /** Fraction, not a percentage: 0.16 for Mexico's standard IVA. */
  taxRate?: string;
  satProductCode?: string | null;
  internalUnit?: string;
  satUnitCode?: string | null;
  trackInventory?: boolean;
}

export type ProductPatch = Partial<Omit<ProductInput, "sku">>;

export interface ProductSearchParams {
  /** Matched against SKU, name and description. */
  query?: string;
  kind?: ProductKind;
  includeInactive?: boolean;
  /** Only products whose stock the inventory ledger tracks. */
  trackInventoryOnly?: boolean;
  limit?: number;
  offset?: number;
}
