import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import type { ActorContext } from "@maicora/shared";
import { ApprovalRequiredError, ConflictError, ForbiddenError } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { newId } from "@maicora/shared";
import { ExecutorRegistry, ProposalService } from "./service.js";
import type { CreateProposalInput, ExecutionOutcome } from "./types.js";

const dbReachable = await isTestDbReachable();

describe.skipIf(!dbReachable)("ProposalService (integration)", () => {
  const db = getTestDb();

  function actorWithRole(base: { tenantId: string; branchId: string; userId: string; membershipId: string }, role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER"): ActorContext {
    return { ...base, roles: [role], permissions: permissionsForRole(role) };
  }

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  function draftInput(kind: CreateProposalInput["kind"], requestedBy: string, key: string): CreateProposalInput {
    return {
      kind,
      payload: { example: true },
      diff: { title: "Test proposal", sections: [{ lines: ["nothing interesting"] }] },
      requestedBy,
      idempotencyKey: key,
    };
  }

  it("self-approves DRAFT-risk kinds (e.g. CUSTOMER_CREATE) and lets them execute immediately", async () => {
    const tenant = await seedTenant(db);
    const actor = actorWithRole(tenant, "STAFF");
    const registry = new ExecutorRegistry();
    let calls = 0;
    const customerId = newId();
    registry.register("CUSTOMER_CREATE", async () => {
      calls += 1;
      const outcome: ExecutionOutcome = {
        entityType: "customer",
        entityId: customerId,
        action: "CREATE",
        before: null,
        after: { name: "ACME" },
        reversible: true,
        result: { customerId },
      };
      return outcome;
    });
    const service = new ProposalService(db, registry);

    const proposal = await service.create(actor, draftInput("CUSTOMER_CREATE", actor.userId, "key-1"));
    expect(proposal.status).toBe("APPROVED");
    expect(proposal.risk).toBe("DRAFT");

    const { proposal: executed, changeset } = await service.execute(actor, proposal.id);
    expect(executed.status).toBe("EXECUTED");
    expect(changeset?.entityType).toBe("customer");
    expect(calls).toBe(1);
  });

  it("requires PENDING_APPROVAL -> APPROVED before executing APPROVAL_REQUIRED kinds", async () => {
    const tenant = await seedTenant(db);
    const staff = actorWithRole(tenant, "STAFF");
    const admin = actorWithRole(tenant, "ADMIN");
    const registry = new ExecutorRegistry();
    const movementId = newId();
    registry.register("INVENTORY_ADJUSTMENT", async () => ({
      entityType: "inventory_movement",
      entityId: movementId,
      action: "ADJUST",
      before: { quantity: "52" },
      after: { quantity: "47" },
      reversible: false,
      result: { movementId },
    }));
    const service = new ProposalService(db, registry);

    const proposal = await service.create(staff, draftInput("INVENTORY_ADJUSTMENT", staff.userId, "key-2"));
    expect(proposal.status).toBe("PENDING_APPROVAL");

    await expect(service.execute(staff, proposal.id)).rejects.toThrow(ApprovalRequiredError);

    // STAFF cannot approve its own proposal.
    await expect(service.approve(staff, proposal.id)).rejects.toThrow(ForbiddenError);

    const approved = await service.approve(admin, proposal.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe(admin.userId);

    const { proposal: executed, changeset } = await service.execute(admin, proposal.id);
    expect(executed.status).toBe("EXECUTED");
    expect(changeset?.action).toBe("ADJUST");
  });

  it("is idempotent on proposal creation by idempotency key", async () => {
    const tenant = await seedTenant(db);
    const actor = actorWithRole(tenant, "STAFF");
    const registry = new ExecutorRegistry();
    const service = new ProposalService(db, registry);

    const first = await service.create(actor, draftInput("CUSTOMER_CREATE", actor.userId, "dup-key"));
    const second = await service.create(actor, draftInput("CUSTOMER_CREATE", actor.userId, "dup-key"));
    expect(second.id).toBe(first.id);

    const all = await service.list(actor);
    expect(all.filter((p) => p.idempotencyKey === "dup-key")).toHaveLength(1);
  });

  it("does not re-run the executor when executing an already-executed proposal (no duplicate fiscal operations)", async () => {
    const tenant = await seedTenant(db);
    const actor = actorWithRole(tenant, "ADMIN");
    const registry = new ExecutorRegistry();
    let calls = 0;
    const invoiceId = newId();
    registry.register("INVOICE_CREATE", async () => {
      calls += 1;
      return {
        entityType: "invoice",
        entityId: invoiceId,
        action: "EXECUTE",
        before: null,
        after: { status: "STAMPED", uuid: "fixed-uuid" },
        reversible: false,
        result: { uuidFiscal: "fixed-uuid" },
      };
    });
    const service = new ProposalService(db, registry);

    const proposal = await service.create(actor, draftInput("INVOICE_CREATE", actor.userId, "key-invoice"));
    await service.approve(actor, proposal.id);

    const first = await service.execute(actor, proposal.id);
    const second = await service.execute(actor, proposal.id);

    expect(calls).toBe(1);
    expect(second.proposal.executionResult).toEqual(first.proposal.executionResult);
    expect(second.changeset?.id).toBe(first.changeset?.id);
  });

  it("reverts a reversible ChangeSet once, and refuses a compensatable one", async () => {
    const tenant = await seedTenant(db);
    const admin = actorWithRole(tenant, "ADMIN");
    const registry = new ExecutorRegistry();
    const customerId = newId();
    const movementId = newId();
    registry.register("CUSTOMER_UPDATE", async () => ({
      entityType: "customer",
      entityId: customerId,
      action: "UPDATE",
      before: { displayName: "ACME" },
      after: { displayName: "ACME S.A." },
      reversible: true,
      result: { customerId },
    }));
    registry.register("INVENTORY_ADJUSTMENT", async () => ({
      entityType: "inventory_movement",
      entityId: movementId,
      action: "ADJUST",
      before: { quantity: "52" },
      after: { quantity: "47" },
      reversible: false,
      result: { movementId },
    }));
    const undone: Record<string, unknown>[] = [];
    registry.registerReverter("customer", async ({ changeset }) => {
      undone.push(changeset.before ?? {});
      return {
        entityType: "customer",
        entityId: changeset.entityId,
        action: "REVERT",
        before: changeset.after,
        after: changeset.before,
        reversible: false,
        result: { customerId: changeset.entityId },
      };
    });
    const service = new ProposalService(db, registry);

    // CUSTOMER_UPDATE is DRAFT risk, so it arrives already approved.
    const edit = await service.create(admin, draftInput("CUSTOMER_UPDATE", admin.userId, "key-revert"));
    const { changeset } = await service.execute(admin, edit.id);

    const revert = await service.revert(admin, changeset!.id);
    expect(revert.action).toBe("REVERT");
    expect(revert.after).toEqual({ displayName: "ACME" });
    expect(undone).toEqual([{ displayName: "ACME" }]);

    // The original is marked, so the same undo cannot be applied twice.
    const rows = await service.listChangesets(admin, "customer", customerId);
    expect(rows.find((r) => r.id === changeset!.id)?.revertedByChangesetId).toBe(revert.id);
    await expect(service.revert(admin, changeset!.id)).rejects.toThrow(ConflictError);

    const adjustment = await service.create(admin, draftInput("INVENTORY_ADJUSTMENT", admin.userId, "key-revert-stock"));
    await service.approve(admin, adjustment.id);
    const applied = await service.execute(admin, adjustment.id);
    await expect(service.revert(admin, applied.changeset!.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a pending proposal and blocks further approval", async () => {
    const tenant = await seedTenant(db);
    const admin = actorWithRole(tenant, "ADMIN");
    const registry = new ExecutorRegistry();
    const service = new ProposalService(db, registry);

    const proposal = await service.create(admin, draftInput("PRICE_UPDATE", admin.userId, "key-reject"));
    const rejected = await service.reject(admin, proposal.id, "Price too aggressive");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Price too aggressive");

    await expect(service.approve(admin, proposal.id)).rejects.toThrow(ConflictError);
  });
});
