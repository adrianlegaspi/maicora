import { pgTable, uuid, text, timestamp, boolean, numeric, integer, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";
import { products } from "./catalog.js";

export const costPattern = pgEnum("cost_pattern", ["RESALE", "MANUFACTURED", "SERVICE"]);

export const costComponentType = pgEnum("cost_component_type", [
  "MATERIAL",
  "PURCHASE_COST",
  "MACHINE_TIME",
  "EQUIPMENT_ALLOCATION",
  "ENERGY",
  "LABOR",
  "PACKAGING",
  "FREIGHT",
  "DELIVERY",
  "WASTE",
  "TRANSACTION_FEE",
  "MARKETPLACE_FEE",
  "FIXED_OVERHEAD",
  "VARIABLE_OVERHEAD",
  "OTHER",
]);

/**
 * Cost models are versioned (docs/mvp/06-pricing-and-costing.md): a new
 * version is inserted rather than mutating history in place, and exactly one
 * version per product is flagged `isCurrent`. This keeps historical cost
 * assumptions inspectable.
 */
export const costModels = pgTable("cost_models", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  pattern: costPattern("pattern").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  targetMargin: numeric("target_margin", { precision: 6, scale: 4 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
}, (table) => [
  unique("cost_models_product_version_unique").on(table.productId, table.version),
  index("cost_models_tenant_product_idx").on(table.tenantId, table.productId),
]);

export const costComponents = pgTable("cost_components", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  costModelId: uuid("cost_model_id")
    .notNull()
    .references(() => costModels.id, { onDelete: "cascade" }),
  type: costComponentType("type").notNull(),
  label: text("label").notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  notes: text("notes"),
}, (table) => [
  index("cost_components_tenant_model_idx").on(table.tenantId, table.costModelId),
]);
