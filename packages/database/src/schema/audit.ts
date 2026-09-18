import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";

/**
 * Broader security event log than `changesets`: authentication, tenant
 * switches, permission denials, agent tool invocations, and MCP calls. Every
 * write-capable action passes through here even when it doesn't produce a
 * ChangeSet (e.g. a rejected proposal, a denied permission check).
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("audit_log_tenant_action_idx").on(table.tenantId, table.action),
]);
