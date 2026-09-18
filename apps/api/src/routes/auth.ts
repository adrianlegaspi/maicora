import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UnauthenticatedError } from "@maicora/shared";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens"),
});

/** Screens 1 and 2 (Login, Tenant selector) and the permission set behind them. */
export function authRoutes(app: FastifyInstance, container: Container): void {
  app.get("/me", async (request) => {
    const userId = request.userId;
    if (!userId) throw new UnauthenticatedError();

    return {
      userId,
      memberships: await container.auth.listMemberships(userId),
      // Present only once a company is selected; the switcher works without it.
      actor: request.actor
        ? { ...request.actor, permissions: [...request.actor.permissions] }
        : null,
    };
  });

  app.post("/tenants", async (request, reply) => {
    const userId = request.userId;
    if (!userId) throw new UnauthenticatedError();
    const input = createTenantSchema.parse(request.body);

    const membership = await container.auth.createTenant(userId, input);
    await container.audit.recordSafely({ tenantId: membership.tenantId }, userId, {
      action: "tenant.create",
      entityType: "tenant",
      entityId: membership.tenantId,
    });

    return reply.status(201).send(membership);
  });

  app.get("/memory", async (request) => container.memory.list(requireActor(request)));

  app.put("/memory/:key", async (request) => {
    const actor = requireActor(request);
    const { key } = request.params as { key: string };
    const body = z.object({ value: z.unknown(), shared: z.boolean().optional() }).parse(request.body);
    await container.memory.remember(actor, key, body.value, { shared: body.shared });
    return { ok: true };
  });

  app.delete("/memory/:key", async (request) => {
    const actor = requireActor(request);
    const { key } = request.params as { key: string };
    const shared = (request.query as { shared?: string }).shared === "true";
    await container.memory.forget(actor, key, { shared });
    return { ok: true };
  });
}
