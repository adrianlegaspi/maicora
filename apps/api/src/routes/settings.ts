import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS, assertPermission } from "@maicora/tenancy";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const roleSchema = z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]);
const addMemberSchema = z.object({ email: z.string().email(), role: roleSchema });
const patchMemberSchema = z.object({ role: roleSchema.optional(), isActive: z.boolean().optional() });

/** Screens 21 (Tenant/user/permission settings) and 22 (AI settings). */
export function settingsRoutes(app: FastifyInstance, container: Container): void {
  app.get("/members", async (request) => container.auth.listMembers(requireActor(request)));

  app.post("/members", async (request, reply) => {
    const actor = requireActor(request);
    const input = addMemberSchema.parse(request.body);
    const member = await container.auth.addMember(actor, input.email, input.role);
    await container.audit.recordSafely(actor, actor.userId, {
      action: "member.add",
      entityType: "membership",
      entityId: member.membershipId,
      metadata: { role: member.role },
    });
    return reply.status(201).send(member);
  });

  app.patch("/members/:id", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const member = await container.auth.updateMember(actor, id, patchMemberSchema.parse(request.body));
    await container.audit.recordSafely(actor, actor.userId, {
      action: "member.update",
      entityType: "membership",
      entityId: id,
      metadata: { role: member.role, isActive: member.isActive },
    });
    return member;
  });

  /**
   * The model and endpoint are server configuration, not tenant data: the API
   * key lives only in the API's environment and is never returned, so this
   * screen reports what is in force rather than offering to edit it.
   */
  app.get("/ai-settings", async (request) => {
    const actor = requireActor(request);
    assertPermission(actor, PERMISSIONS.AI_SETTINGS_MANAGE);
    const ai = container.config.ai;
    return {
      configured: Boolean(ai),
      model: ai?.model ?? null,
      baseUrl: ai?.baseUrl ?? null,
      mcpEnabled: actor.permissions.has(PERMISSIONS.MCP_ACCESS),
    };
  });
}
