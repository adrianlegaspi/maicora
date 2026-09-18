import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

/**
 * The capability registry is also the read API: screens call the same objects
 * the agent does, so a list the agent can see and a list the UI can see can
 * never disagree, and a permission cannot be enforced in one path only.
 */
export function capabilityRoutes(app: FastifyInstance, container: Container): void {
  app.get("/capabilities", async (request) => {
    const actor = requireActor(request);
    return container.capabilities.listFor(actor).map((capability) => ({
      name: capability.name,
      description: capability.description,
      readOnly: capability.readOnly,
    }));
  });

  app.post("/capabilities/:name", async (request) => {
    const actor = requireActor(request);
    const { name } = request.params as { name: string };

    const result = await container.capabilities.invoke(actor, name, request.body ?? {}, {
      channel: "api",
    });

    const capability = container.capabilities.get(name);
    if (!capability.readOnly) {
      await container.audit.recordSafely(actor, actor.userId, {
        action: `capability.${name}`,
        metadata: { channel: "api" },
      });
    }

    return result;
  });
}
