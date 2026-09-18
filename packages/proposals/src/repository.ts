import { eq, and, desc } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { BusinessDiff } from "./diff.js";
import type {
  ChangesetInput,
  ChangesetRecord,
  CreateProposalInput,
  ExecutionOutcome,
  ProposalKind,
  ProposalRecord,
  ProposalRisk,
  ProposalStatus,
} from "./types.js";

function toRecord(row: typeof schema.proposals.$inferSelect): ProposalRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ProposalKind,
    status: row.status as ProposalStatus,
    risk: row.risk as ProposalRisk,
    payload: row.payload as Record<string, unknown>,
    diff: row.diff as unknown as BusinessDiff,
    requestedBy: row.requestedBy,
    requestedByAgent: row.requestedByAgent,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    executedAt: row.executedAt,
    executionResult: row.executionResult as Record<string, unknown> | null,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChangesetRecord(row: typeof schema.changesets.$inferSelect): ChangesetRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    proposalId: row.proposalId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action as ChangesetRecord["action"],
    before: row.before as Record<string, unknown> | null,
    after: row.after as Record<string, unknown> | null,
    reversible: row.reversible,
    revertedAt: row.revertedAt,
    revertedByChangesetId: row.revertedByChangesetId,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

export class ProposalRepository {
  constructor(private readonly db: DbClient) {}

  async insert(scope: TenantScope, input: CreateProposalInput, risk: ProposalRisk): Promise<ProposalRecord> {
    // Risk DRAFT self-approves at creation time: see PROPOSAL_KIND_RISK in
    // types.ts for why (only specific actions require a human approver).
    const selfApproved = risk === "DRAFT";
    const now = new Date();
    const [row] = await this.db
      .insert(schema.proposals)
      .values({
        id: newId(),
        tenantId: scope.tenantId,
        kind: input.kind,
        status: selfApproved ? "APPROVED" : "PENDING_APPROVAL",
        risk,
        payload: input.payload,
        diff: input.diff as unknown as object,
        requestedBy: input.requestedBy,
        requestedByAgent: input.requestedByAgent ?? false,
        approvedBy: selfApproved ? input.requestedBy : null,
        approvedAt: selfApproved ? now : null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    if (!row) throw new Error("Failed to insert proposal");
    return toRecord(row);
  }

  async findById(scope: TenantScope, id: string): Promise<ProposalRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.id, id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<ProposalRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.idempotencyKey, idempotencyKey)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async list(scope: TenantScope, status?: ProposalStatus): Promise<ProposalRecord[]> {
    const conditions = status
      ? and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.status, status))
      : eq(schema.proposals.tenantId, scope.tenantId);
    const rows = await this.db
      .select()
      .from(schema.proposals)
      .where(conditions)
      .orderBy(desc(schema.proposals.createdAt));
    return rows.map(toRecord);
  }

  async approve(scope: TenantScope, id: string, approvedBy: string): Promise<ProposalRecord> {
    const [row] = await this.db
      .update(schema.proposals)
      .set({ status: "APPROVED", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.id, id)))
      .returning();
    if (!row) throw new Error(`Proposal ${id} not found`);
    return toRecord(row);
  }

  async reject(scope: TenantScope, id: string, rejectedBy: string, reason: string): Promise<ProposalRecord> {
    const [row] = await this.db
      .update(schema.proposals)
      .set({
        status: "REJECTED",
        rejectedBy,
        rejectedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.id, id)))
      .returning();
    if (!row) throw new Error(`Proposal ${id} not found`);
    return toRecord(row);
  }

  async markExecuted(
    scope: TenantScope,
    id: string,
    executionResult: Record<string, unknown>,
  ): Promise<ProposalRecord> {
    const [row] = await this.db
      .update(schema.proposals)
      .set({ status: "EXECUTED", executedAt: new Date(), executionResult, updatedAt: new Date() })
      .where(and(eq(schema.proposals.tenantId, scope.tenantId), eq(schema.proposals.id, id)))
      .returning();
    if (!row) throw new Error(`Proposal ${id} not found`);
    return toRecord(row);
  }

  async insertChangeset(scope: TenantScope, input: ChangesetInput): Promise<ChangesetRecord> {
    const [row] = await this.db
      .insert(schema.changesets)
      .values({
        id: input.id ?? newId(),
        tenantId: scope.tenantId,
        proposalId: input.proposalId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        before: input.before,
        after: input.after,
        reversible: input.reversible,
        actorId: input.actorId,
      })
      .returning();
    if (!row) throw new Error("Failed to insert changeset");
    return toChangesetRecord(row);
  }

  /** Writes the executor's outcome onto the placeholder row inserted before it ran. */
  async finalizeChangeset(scope: TenantScope, changesetId: string, outcome: ExecutionOutcome): Promise<ChangesetRecord> {
    const [row] = await this.db
      .update(schema.changesets)
      .set({
        entityType: outcome.entityType,
        entityId: outcome.entityId,
        action: outcome.action,
        before: outcome.before,
        after: outcome.after,
        reversible: outcome.reversible,
      })
      .where(and(eq(schema.changesets.tenantId, scope.tenantId), eq(schema.changesets.id, changesetId)))
      .returning();
    if (!row) throw new Error("Failed to finalize changeset");
    return toChangesetRecord(row);
  }

  async listChangesets(scope: TenantScope, entityType?: string, entityId?: string): Promise<ChangesetRecord[]> {
    const conditions = [eq(schema.changesets.tenantId, scope.tenantId)];
    if (entityType) conditions.push(eq(schema.changesets.entityType, entityType));
    if (entityId) conditions.push(eq(schema.changesets.entityId, entityId));
    const rows = await this.db
      .select()
      .from(schema.changesets)
      .where(and(...conditions))
      .orderBy(desc(schema.changesets.createdAt));
    return rows.map(toChangesetRecord);
  }

  async findChangesetByProposalId(scope: TenantScope, proposalId: string): Promise<ChangesetRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.changesets)
      .where(and(eq(schema.changesets.tenantId, scope.tenantId), eq(schema.changesets.proposalId, proposalId)))
      .limit(1);
    return row ? toChangesetRecord(row) : null;
  }

  async findChangesetById(scope: TenantScope, id: string): Promise<ChangesetRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.changesets)
      .where(and(eq(schema.changesets.tenantId, scope.tenantId), eq(schema.changesets.id, id)))
      .limit(1);
    return row ? toChangesetRecord(row) : null;
  }

  async markChangesetReverted(scope: TenantScope, id: string, revertedByChangesetId: string): Promise<void> {
    await this.db
      .update(schema.changesets)
      .set({ revertedAt: new Date(), revertedByChangesetId })
      .where(and(eq(schema.changesets.tenantId, scope.tenantId), eq(schema.changesets.id, id)));
  }
}
