import type { ActorContext } from "@maicora/shared";
import { ApprovalRequiredError, ConflictError, NotFoundError, newId } from "@maicora/shared";
import type { Database, Tx } from "@maicora/database";
import { assertPermission } from "@maicora/tenancy";
import { PERMISSIONS } from "@maicora/tenancy";
import { ProposalRepository } from "./repository.js";
import { PROPOSAL_KIND_RISK } from "./types.js";
import type {
  ChangesetRecord,
  CreateProposalInput,
  ExecutionOutcome,
  ProposalKind,
  ProposalRecord,
} from "./types.js";

export type Executor = (ctx: {
  tx: Tx;
  actor: ActorContext;
  payload: Record<string, unknown>;
  proposalId: string;
  /**
   * The id the ChangeSet for this execution will be inserted with, generated
   * up front so an executor can stamp it onto the rows it writes (an
   * inventory movement must record its ChangeSet - docs/mvp/05-inventory.md).
   */
  changesetId: string;
}) => Promise<ExecutionOutcome>;

/**
 * One executor per proposal kind, registered by the owning domain package at
 * app startup (packages/invoices registers INVOICE_CREATE, packages/inventory
 * registers INVENTORY_ADJUSTMENT, etc). This is the single place execution
 * logic runs from regardless of caller (REST API, agent, or MCP), satisfying
 * "no business logic inside MCP handlers" by construction: MCP calls the
 * same service, never re-implements the mutation.
 */
/**
 * Puts one reversible ChangeSet back, keyed by the entity type it touched.
 * Registered by the same domain package that registered the executor which
 * produced the ChangeSet.
 */
export type Reverter = (ctx: {
  tx: Tx;
  actor: ActorContext;
  changeset: ChangesetRecord;
}) => Promise<ExecutionOutcome>;

export class ExecutorRegistry {
  private readonly executors = new Map<ProposalKind, Executor>();
  private readonly reverters = new Map<string, Reverter>();

  register(kind: ProposalKind, executor: Executor): void {
    this.executors.set(kind, executor);
  }

  get(kind: ProposalKind): Executor {
    const executor = this.executors.get(kind);
    if (!executor) throw new Error(`No executor registered for proposal kind ${kind}`);
    return executor;
  }

  registerReverter(entityType: string, reverter: Reverter): void {
    this.reverters.set(entityType, reverter);
  }

  getReverter(entityType: string): Reverter | undefined {
    return this.reverters.get(entityType);
  }
}

export class ProposalService {
  constructor(
    private readonly db: Database,
    private readonly registry: ExecutorRegistry,
  ) {}

  async create(actor: ActorContext, input: CreateProposalInput): Promise<ProposalRecord> {
    const repo = new ProposalRepository(this.db);
    const existing = await repo.findByIdempotencyKey(actor, input.idempotencyKey);
    if (existing) return existing;
    const risk = PROPOSAL_KIND_RISK[input.kind];
    return repo.insert(actor, input, risk);
  }

  async get(actor: ActorContext, proposalId: string): Promise<ProposalRecord> {
    const repo = new ProposalRepository(this.db);
    const proposal = await repo.findById(actor, proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    return proposal;
  }

  async list(actor: ActorContext, status?: ProposalRecord["status"]) {
    assertPermission(actor, PERMISSIONS.PROPOSALS_READ);
    return new ProposalRepository(this.db).list(actor, status);
  }

  /** The history screen: what actually changed, optionally for one entity. */
  async listChangesets(actor: ActorContext, entityType?: string, entityId?: string) {
    assertPermission(actor, PERMISSIONS.PROPOSALS_READ);
    return new ProposalRepository(this.db).listChangesets(actor, entityType, entityId);
  }

  async approve(actor: ActorContext, proposalId: string): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.PROPOSALS_APPROVE);
    const repo = new ProposalRepository(this.db);
    const proposal = await repo.findById(actor, proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Proposal ${proposalId} is not pending approval`, { status: proposal.status });
    }
    return repo.approve(actor, proposalId, actor.userId);
  }

  async reject(actor: ActorContext, proposalId: string, reason: string): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.PROPOSALS_REJECT);
    const repo = new ProposalRepository(this.db);
    const proposal = await repo.findById(actor, proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Proposal ${proposalId} is not pending approval`, { status: proposal.status });
    }
    return repo.reject(actor, proposalId, actor.userId, reason);
  }

  /**
   * Executes an approved proposal inside a single DB transaction alongside
   * its ChangeSet. Idempotent: re-invoking on an already-executed proposal
   * returns the original result instead of running the executor again
   * (docs/mvp/12-agent-evaluations.md, "Duplicate execution").
   */
  async execute(actor: ActorContext, proposalId: string): Promise<{ proposal: ProposalRecord; changeset: ChangesetRecord | null }> {
    const readRepo = new ProposalRepository(this.db);
    const proposal = await readRepo.findById(actor, proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);

    if (proposal.status === "EXECUTED") {
      const changeset = await readRepo.findChangesetByProposalId(actor, proposalId);
      return { proposal, changeset };
    }
    if (proposal.status !== "APPROVED") {
      throw new ApprovalRequiredError(`execute:${proposal.kind}`);
    }

    const executor = this.registry.get(proposal.kind);
    return this.db.transaction(async (tx) => {
      const repo = new ProposalRepository(tx);
      // The ChangeSet row is inserted before the executor runs so rows the
      // executor writes can carry a valid foreign key to it (an inventory
      // movement must record its ChangeSet - docs/mvp/05-inventory.md), then
      // filled in from the outcome. Both statements share this transaction,
      // so a failing executor rolls the placeholder back with everything else.
      const changesetId = newId();
      await repo.insertChangeset(actor, {
        id: changesetId,
        proposalId: proposal.id,
        entityType: proposal.kind,
        entityId: proposal.id,
        action: "EXECUTE",
        before: null,
        after: null,
        reversible: false,
        actorId: actor.userId,
      });
      const outcome = await executor({ tx, actor, payload: proposal.payload, proposalId: proposal.id, changesetId });
      const changeset = await repo.finalizeChangeset(actor, changesetId, outcome);
      const executedProposal = await repo.markExecuted(actor, proposal.id, outcome.result);
      return { proposal: executedProposal, changeset };
    });
  }

  /**
   * Puts a reversible ChangeSet back (docs/mvp/09-proposals-and-governance.md,
   * "ChangeSets and Undo"). Only changes the spec lists as reversible - a
   * customer or product edit, a price change - can go this way. Stock and
   * fiscal documents are compensatable instead: you post a counter-movement
   * or a legal cancellation, and this refuses rather than rewriting history
   * (non-negotiable #12).
   */
  async revert(actor: ActorContext, changesetId: string): Promise<ChangesetRecord> {
    assertPermission(actor, PERMISSIONS.PROPOSALS_APPROVE);
    const changeset = await new ProposalRepository(this.db).findChangesetById(actor, changesetId);
    if (!changeset) throw new NotFoundError("ChangeSet", changesetId);
    if (!changeset.reversible) {
      throw new ConflictError("This change cannot be undone; it needs a compensating action instead", {
        entityType: changeset.entityType,
        action: changeset.action,
      });
    }
    if (changeset.revertedAt) {
      throw new ConflictError("This change has already been undone", { revertedAt: changeset.revertedAt });
    }
    const reverter = this.registry.getReverter(changeset.entityType);
    if (!reverter) {
      throw new ConflictError("Nothing knows how to undo this kind of change", {
        entityType: changeset.entityType,
      });
    }

    return this.db.transaction(async (tx) => {
      const repo = new ProposalRepository(tx);
      const outcome = await reverter({ tx, actor, changeset });
      const created = await repo.insertChangeset(actor, {
        proposalId: null,
        entityType: outcome.entityType,
        entityId: outcome.entityId,
        action: "REVERT",
        before: outcome.before,
        after: outcome.after,
        // An undo is itself history: undoing it again would be a second
        // edit, drafted like any other.
        reversible: false,
        actorId: actor.userId,
      });
      await repo.markChangesetReverted(actor, changeset.id, created.id);
      return created;
    });
  }
}
