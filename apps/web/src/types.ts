/**
 * The API's response shapes, restated for the browser. The server packages
 * are Node-only (drizzle, postgres), so the frontend cannot import their
 * types; these cover only the fields screens actually render.
 */
export type Role = "OWNER" | "ADMIN" | "STAFF" | "VIEWER";

export interface Membership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  membershipId: string;
  role: Role;
}

export interface Me {
  userId: string;
  memberships: Membership[];
  actor: { tenantId: string; roles: Role[]; permissions: string[] } | null;
}

export interface Customer {
  id: string;
  displayName: string;
  legalName: string | null;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  taxRegime: string | null;
  fiscalPostalCode: string | null;
  cfdiUseDefault: string | null;
  kind: string;
  isArchived: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  kind: string;
  description: string | null;
  internalUnit: string | null;
  salePrice: string | null;
  taxRate: string | null;
  currency: string;
  trackInventory: boolean;
  currentEstimatedCost: string | null;
  satProductCode: string | null;
  satUnitCode: string | null;
  isActive: boolean;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouseCode: string;
  quantityOnHand: string;
}

export interface Movement {
  id: string;
  productId: string;
  warehouseId: string;
  movementType: string;
  direction: "IN" | "OUT";
  quantity: string;
  source: string;
  reason: string | null;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

export interface Invoice {
  id: string;
  kind: string;
  status: string;
  environment: string;
  customerId: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paymentForm: string | null;
  paymentMethod: string | null;
  cfdiUse: string | null;
  uuidFiscal: string | null;
  cancellationReason: string | null;
  createdAt: string;
  stampedAt: string | null;
  cancelledAt: string | null;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  productId: string | null;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxAmount: string;
  total: string;
}

export interface DiffChange {
  label: string;
  before?: string;
  after?: string;
}

export interface DiffSection {
  heading?: string;
  lines?: string[];
  changes?: DiffChange[];
}

export interface Proposal {
  id: string;
  kind: string;
  status: string;
  risk: string;
  payload: Record<string, unknown>;
  diff: { title: string; sections: DiffSection[] };
  requestedBy: string;
  requestedByAgent: boolean;
  rejectionReason: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface Changeset {
  id: string;
  proposalId: string | null;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reversible: boolean;
  revertedAt: string | null;
  revertedByChangesetId: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PricingSummary {
  productId: string;
  costModelId: string;
  costModelVersion: number;
  currency: string;
  trueEstimatedCost: string;
  breakEvenPrice: string;
  currentSalePrice: string | null;
  currentMarkup: string | null;
  currentGrossMargin: string | null;
  profitPerUnitAtCurrentPrice: string | null;
  targetMargin: string | null;
  recommendedPriceForTargetMargin: string | null;
  costBreakdown: { type: string; label: string; amount: string }[];
}

export interface Scenario {
  label: string;
  salePrice: string;
  markup: string;
  grossMargin: string;
  profitPerUnit: string;
}

export interface FiscalSettings {
  id: string;
  environment: "SANDBOX" | "PRODUCTION";
  rfcEmisor: string;
  legalNameEmisor: string;
  regimenFiscal: string;
  lugarExpedicion: string;
  pacProvider: string | null;
  csdCertRef: string | null;
  csdKeyRef: string | null;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  role: Role;
  isActive: boolean;
}

export interface FiscalReadiness {
  customerId: string;
  displayName: string;
  ready: boolean;
  missing: string[];
}
