import { pgTable, uuid, text, timestamp, boolean, numeric, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";

export const productKind = pgEnum("product_kind", ["PRODUCT", "SERVICE"]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),

  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  kind: productKind("kind").notNull().default("PRODUCT"),
  isActive: boolean("is_active").notNull().default(true),

  salePrice: numeric("sale_price", { precision: 18, scale: 6 }).notNull().default("0"),
  currency: text("currency").notNull().default("MXN"),
  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull().default("0.16"),

  satProductCode: text("sat_product_code"),
  internalUnit: text("internal_unit").notNull().default("pza"),
  satUnitCode: text("sat_unit_code"),

  trackInventory: boolean("track_inventory").notNull().default(true),
  currentEstimatedCost: numeric("current_estimated_cost", { precision: 18, scale: 6 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("products_tenant_sku_unique").on(table.tenantId, table.sku),
  index("products_tenant_name_idx").on(table.tenantId, table.name),
]);
