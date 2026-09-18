import { pgTable, uuid, text, timestamp, numeric, integer, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { tenants, branches } from "./tenancy.js";
import { customers } from "./customers.js";
import { products } from "./catalog.js";

export const invoiceKind = pgEnum("invoice_kind", ["INGRESO", "EGRESO", "GLOBAL"]);

export const invoiceStatus = pgEnum("invoice_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "STAMPED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "ERROR",
]);

export const fiscalEnvironment = pgEnum("fiscal_environment", ["SANDBOX", "PRODUCTION"]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  /** Null for "publico en general". */
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),

  kind: invoiceKind("kind").notNull().default("INGRESO"),
  status: invoiceStatus("status").notNull().default("DRAFT"),
  environment: fiscalEnvironment("environment").notNull().default("SANDBOX"),

  currency: text("currency").notNull().default("MXN"),
  subtotal: numeric("subtotal", { precision: 18, scale: 6 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 18, scale: 6 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 6 }).notNull().default("0"),

  paymentForm: text("payment_form"),
  paymentMethod: text("payment_method"),
  cfdiUse: text("cfdi_use"),
  placeOfIssuance: text("place_of_issuance"),

  /** For EGRESO (credit note) and CANCELLED: the invoice this one relates to. */
  relatedInvoiceId: uuid("related_invoice_id"),

  uuidFiscal: text("uuid_fiscal"),
  xmlStoragePath: text("xml_storage_path"),
  pdfStoragePath: text("pdf_storage_path"),
  cancellationReason: text("cancellation_reason"),

  /** Deduplicates repeated execution of the same approved proposal. */
  idempotencyKey: text("idempotency_key").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  stampedAt: timestamp("stamped_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  unique("invoices_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
  index("invoices_tenant_status_idx").on(table.tenantId, table.status),
  index("invoices_tenant_customer_idx").on(table.tenantId, table.customerId),
]);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),

  lineNumber: integer("line_number").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 6 }).notNull(),
  discount: numeric("discount", { precision: 18, scale: 6 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull().default("0.16"),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 6 }).notNull(),
  total: numeric("total", { precision: 18, scale: 6 }).notNull(),
}, (table) => [
  index("invoice_items_tenant_invoice_idx").on(table.tenantId, table.invoiceId),
]);

/**
 * One row per tenant per environment. CSD private key material is never
 * stored as plaintext: `csdKeyRef`/`csdCertRef` are opaque references into a
 * secrets store (or the fiscal engine's own encrypted vault); the Node side
 * never reads or transmits the raw key (docs/mvp/07-invoicing-cfdi.md).
 */
export const fiscalSettings = pgTable("fiscal_settings", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  environment: fiscalEnvironment("environment").notNull().default("SANDBOX"),
  pacProvider: text("pac_provider").notNull().default("mock"),
  rfcEmisor: text("rfc_emisor"),
  legalNameEmisor: text("legal_name_emisor"),
  regimenFiscal: text("regimen_fiscal"),
  lugarExpedicion: text("lugar_expedicion"),
  csdCertRef: text("csd_cert_ref"),
  csdKeyRef: text("csd_key_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("fiscal_settings_tenant_environment_unique").on(table.tenantId, table.environment),
]);
