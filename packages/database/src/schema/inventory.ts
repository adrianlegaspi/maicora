import { pgTable, uuid, text, timestamp, boolean, numeric, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { tenants, branches } from "./tenancy.js";
import { products } from "./catalog.js";
import { changesets } from "./proposals.js";

export const inventoryMovementType = pgEnum("inventory_movement_type", [
  "OPENING_BALANCE",
  "MANUAL_ADJUSTMENT",
  "INVOICE_OUT",
  "INVOICE_REVERSAL",
]);

export const movementDirection = pgEnum("movement_direction", ["IN", "OUT"]);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("warehouses_tenant_code_unique").on(table.tenantId, table.code),
]);

/**
 * Materialized "current balance" for fast reads. This table is ONLY ever
 * written inside the same transaction as an `inventoryMovements` insert
 * (see packages/inventory). It must never be mutated directly -
 * non-negotiable #7: "No inventory mutation outside the ledger."
 */
export const inventoryBalances = pgTable("inventory_balances", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  quantityOnHand: numeric("quantity_on_hand", { precision: 18, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("inventory_balances_warehouse_product_unique").on(table.warehouseId, table.productId),
  index("inventory_balances_tenant_idx").on(table.tenantId),
]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  movementType: inventoryMovementType("movement_type").notNull(),
  direction: movementDirection("direction").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  source: text("source").notNull(),
  actorId: uuid("actor_id"),
  changesetId: uuid("changeset_id").references(() => changesets.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("inventory_movements_tenant_product_idx").on(table.tenantId, table.productId),
  index("inventory_movements_tenant_warehouse_idx").on(table.tenantId, table.warehouseId),
  index("inventory_movements_tenant_created_idx").on(table.tenantId, table.createdAt),
]);
