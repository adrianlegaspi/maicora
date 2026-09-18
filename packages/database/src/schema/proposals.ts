import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";

/**
 * One proposal kind per agent "prepare_*" capability
 * (docs/mvp/08-agent.md, docs/mvp/09-proposals-and-governance.md).
 */
export const proposalKind = pgEnum("proposal_kind", [
  "CUSTOMER_CREATE",
  "CUSTOMER_UPDATE",
  "PRICE_UPDATE",
  "INVENTORY_ADJUSTMENT",
  "INVOICE_CREATE",
  "GLOBAL_INVOICE_CREATE",
  "CREDIT_NOTE_CREATE",
  "INVOICE_CANCELLATION",
  "BULK_IMPORT",
]);

export const proposalStatus = pgEnum("proposal_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
  "EXPIRED",
]);

export const proposalRisk = pgEnum("proposal_risk", ["AUTOMATIC", "DRAFT", "APPROVAL_REQUIRED"]);

/**
 * A Business Proposal is the only path to a critical write. It carries the
 * proposed payload, the computed Business Diff shown to the user, and the
 * full approval/execution lifecycle. See docs/mvp/09-proposals-and-governance.md.
 */
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  kind: proposalKind("kind").notNull(),
  status: proposalStatus("status").notNull().default("DRAFT"),
  risk: proposalRisk("risk").notNull(),

  payload: jsonb("payload").notNull(),
  diff: jsonb("diff").notNull(),

  requestedBy: uuid("requested_by").notNull(),
  requestedByAgent: boolean("requested_by_agent").notNull().default(false),

  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),

  executedAt: timestamp("executed_at", { withTimezone: true }),
  executionResult: jsonb("execution_result"),

  /** Guards against duplicate execution of the same approved proposal. */
  idempotencyKey: text("idempotency_key").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("proposals_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
  index("proposals_tenant_status_idx").on(table.tenantId, table.status),
]);

export const changesetAction = pgEnum("changeset_action", [
  "CREATE",
  "UPDATE",
  "ADJUST",
  "EXECUTE",
  "CANCEL",
  "REVERT",
]);

/**
 * The audit/undo trail for every mutation, agent-driven or manual. Entity
 * references are polymorphic (entityType + entityId) by design: a
 * changeset can point at a customer, product, invoice, or inventory
 * movement without this table depending on every domain package.
 */
export const changesets = pgTable("changesets", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),

  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: changesetAction("action").notNull(),

  before: jsonb("before"),
  after: jsonb("after"),

  reversible: boolean("reversible").notNull().default(false),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
  revertedByChangesetId: uuid("reverted_by_changeset_id"),

  actorId: uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("changesets_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId),
  index("changesets_tenant_created_idx").on(table.tenantId, table.createdAt),
]);
