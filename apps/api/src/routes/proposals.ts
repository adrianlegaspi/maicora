import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const rejectSchema = z.object({ reason: z.string().min(1) });

/** Screens 19 and 20 (Proposal review, ChangeSet history). */
export function proposalRoutes(app: FastifyInstance, container: Container): void {
  app.get("/proposals", async (request) => {
    const actor = requireActor(request);
    const { status } = request.query as { status?: string };
    return container.proposals.list(actor, status as never);
  });

  app.get("/proposals/:id", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    return container.proposals.get(actor, id);
  });

  app.post("/proposals/:id/approve", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const proposal = await container.proposals.approve(actor, id);
    await container.audit.recordSafely(actor, actor.userId, {
      action: "proposal.approve",
      entityType: "proposal",
      entityId: id,
      metadata: { kind: proposal.kind },
    });
    return proposal;
  });

  app.post("/proposals/:id/reject", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const { reason } = rejectSchema.parse(request.body);
    const proposal = await container.proposals.reject(actor, id, reason);
    await container.audit.recordSafely(actor, actor.userId, {
      action: "proposal.reject",
      entityType: "proposal",
      entityId: id,
      metadata: { kind: proposal.kind, reason },
    });
    return proposal;
  });

  /**
   * Execution is a separate call from approval so an approver can review and
   * a second, deliberate action applies it. Re-posting is safe: the proposal
   * service returns the existing ChangeSet rather than acting twice.
   */
  app.post("/proposals/:id/execute", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const result = await container.proposals.execute(actor, id);
    await container.audit.recordSafely(actor, actor.userId, {
      action: "proposal.execute",
      entityType: "proposal",
      entityId: id,
      metadata: { changesetId: result.changeset?.id ?? null },
    });
    return result;
  });

  app.get("/changesets", async (request) => {
    const actor = requireActor(request);
    const { entityType, entityId } = request.query as { entityType?: string; entityId?: string };
    return container.proposals.listChangesets(actor, entityType, entityId);
  });

  app.post("/changesets/:id/revert", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const changeset = await container.proposals.revert(actor, id);
    await container.audit.recordSafely(actor, actor.userId, {
      action: "changeset.revert",
      entityType: changeset.entityType,
      entityId: changeset.entityId,
      metadata: { revertedChangesetId: id, changesetId: changeset.id },
    });
    return changeset;
  });

  app.get("/audit", async (request) => {
    const actor = requireActor(request);
    const query = request.query as { action?: string; entityType?: string; entityId?: string; limit?: string };
    return container.audit.list(actor, {
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  });
}
