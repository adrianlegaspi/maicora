import { pgTable, uuid, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";

/**
 * Conservative AI memory (docs/mvp/08-agent.md): preferences and
 * terminology only. Authoritative business facts (stock, prices, invoices)
 * are never written here; they are always re-read from domain tables.
 */
export const agentMemory = pgTable("agent_memory", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** Null = tenant-wide memory (e.g. shared company terminology). */
  userId: uuid("user_id"),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("agent_memory_tenant_user_key_unique").on(table.tenantId, table.userId, table.key),
]);

export const agentConversations = pgTable("agent_conversations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_conversations_tenant_user_idx").on(table.tenantId, table.userId),
]);

export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant" | "tool"
  content: text("content"),
  toolCalls: jsonb("tool_calls"),
  toolResult: jsonb("tool_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_messages_tenant_conversation_idx").on(table.tenantId, table.conversationId),
]);
