import { pgTable, uuid, text, timestamp, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { tenants, branches } from "./tenancy.js";

export const customerKind = pgEnum("customer_kind", ["BUSINESS", "INDIVIDUAL", "PUBLICO_GENERAL"]);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  kind: customerKind("kind").notNull().default("BUSINESS"),

  displayName: text("display_name").notNull(),
  legalName: text("legal_name"),

  // Minimum fiscal data (docs/mvp/04-core-domains.md). Nullable because
  // "publico en general" and draft customers legitimately lack these; the
  // agent's fiscal-readiness capability flags what's missing before invoicing.
  rfc: text("rfc"),
  taxRegime: text("tax_regime"),
  fiscalPostalCode: text("fiscal_postal_code"),
  cfdiUseDefault: text("cfdi_use_default"),

  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  tags: text("tags").array().notNull().default([]),

  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
}, (table) => [
  index("customers_tenant_idx").on(table.tenantId),
  index("customers_tenant_display_name_idx").on(table.tenantId, table.displayName),
  index("customers_tenant_rfc_idx").on(table.tenantId, table.rfc),
]);

export const customerContacts = pgTable("customer_contacts", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("customer_contacts_tenant_customer_idx").on(table.tenantId, table.customerId),
]);

export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  label: text("label"),
  street: text("street"),
  exteriorNumber: text("exterior_number"),
  interiorNumber: text("interior_number"),
  neighborhood: text("neighborhood"),
  municipality: text("municipality"),
  state: text("state"),
  country: text("country").notNull().default("MEX"),
  postalCode: text("postal_code"),
  isFiscal: boolean("is_fiscal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("customer_addresses_tenant_customer_idx").on(table.tenantId, table.customerId),
]);
