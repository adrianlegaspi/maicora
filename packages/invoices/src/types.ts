export type InvoiceKind = "INGRESO" | "EGRESO" | "GLOBAL";

export type InvoiceStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "STAMPED"
  | "CANCELLATION_REQUESTED"
  | "CANCELLED"
  | "ERROR";

export interface InvoiceItemInput {
  /** Omit for a free-text line; required for anything that moves stock. */
  productId?: string;
  /** Defaults to the product's name. */
  description?: string;
  quantity: string;
  /** Defaults to the product's current sale price. */
  unitPrice?: string;
  discount?: string;
  /** Defaults to the product's configured tax rate. */
  taxRate?: string;
}

/** The minimum invoice data from docs/mvp/07-invoicing-cfdi.md. */
export interface PrepareInvoiceInput {
  /** Null issues to publico en general under the SAT's generic RFC. */
  customerId: string | null;
  items: InvoiceItemInput[];
  currency?: string;
  /** SAT c_FormaPago key, e.g. "03" for transfer. */
  paymentForm: string;
  /** SAT c_MetodoPago key: "PUE" or "PPD". */
  paymentMethod: string;
  /** SAT c_UsoCFDI key; falls back to the customer's default. */
  cfdiUse?: string;
  /** SAT postal code; falls back to the tenant's fiscal settings. */
  placeOfIssuance?: string;
  warehouseId?: string;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export interface PrepareGlobalInvoiceInput {
  items: InvoiceItemInput[];
  currency?: string;
  paymentForm: string;
  /** SAT c_Periodicidad key: "01" daily, "02" weekly, "03" fortnightly, "04" monthly. */
  periodicity: string;
  /** SAT c_Meses key, e.g. "01" for January. */
  months: string;
  year: number;
  placeOfIssuance?: string;
  warehouseId?: string;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export interface PrepareCreditNoteInput {
  /** The stamped invoice being corrected. */
  invoiceId: string;
  /** Defaults to every line of the original invoice. */
  items?: InvoiceItemInput[];
  paymentForm: string;
  reason: string;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export interface PrepareCancellationInput {
  invoiceId: string;
  /** SAT cancellation reason key: "01".."04". */
  reason: string;
  /** Required by the SAT when the reason is "01". */
  replacementUuid?: string;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

/** One priced invoice line, after defaults and tax have been resolved. */
export interface ResolvedLine {
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  taxAmount: string;
  /** Line total including tax. */
  total: string;
  /** Pre-tax line amount, i.e. quantity x unitPrice - discount. */
  base: string;
  tracksInventory: boolean;
  sku: string | null;
  satProductCode: string | null;
  satUnitCode: string | null;
  unit: string;
}

export interface InvoiceTotals {
  subtotal: string;
  taxTotal: string;
  total: string;
}

/** What a draft would do to stock, shown in the proposal diff. */
export interface StockImpact {
  productId: string;
  sku: string;
  quantityBefore: string;
  quantityAfter: string;
}

export interface InvoiceSearchParams {
  customerId?: string;
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  limit?: number;
  offset?: number;
}
