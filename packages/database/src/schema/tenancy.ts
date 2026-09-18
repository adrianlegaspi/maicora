import { pgTable, uuid, text, timestamp, boolean, pgEnum, unique } from "drizzle-orm/pg-core";

/**
 * Roles are a fixed enum for the MVP rather than a fully dynamic
 * role/permission editor: docs/mvp/04-core-domains.md lists Role and
 * Permission as entities but the roadmap (Phase 0) scopes this to
 * "Permissions" as an architecture concern, not a admin UI milestone.
 * The role -> permission mapping itself lives in code
 * (packages/tenancy/src/permissions.ts) so it stays auditable and typed.
 */
export const membershipRole = pgEnum("membership_role", ["OWNER", "ADMIN", "STAFF", "VIEWER"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("branches_tenant_code_unique").on(table.tenantId, table.code),
]);

/**
 * Mirrors the subset of a Supabase Auth user Maicora needs for joins and
 * display. Supabase remains the source of truth for credentials; the
 * backend never stores passwords. This row is upserted from the verified
 * JWT on first sight of a user (see packages/auth).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // matches the Supabase auth.users id
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMemberships = pgTable("tenant_memberships", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: membershipRole("role").notNull().default("STAFF"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("tenant_memberships_tenant_user_unique").on(table.tenantId, table.userId),
]);
