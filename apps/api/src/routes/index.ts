import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";
import { authenticate } from "../http.js";
import { agentRoutes } from "./agent.js";
import { authRoutes } from "./auth.js";
import { capabilityRoutes } from "./capabilities.js";
import { domainRoutes } from "./domain.js";
import { importRoutes } from "./imports.js";
import { proposalRoutes } from "./proposals.js";
import { settingsRoutes } from "./settings.js";

/**
 * Everything under /api requires a verified token. Authentication runs as one
 * hook for the whole subtree so a new route cannot forget it.
 */
export async function apiRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.addHook("preHandler", authenticate(container));

  await app.register(async (scope) => authRoutes(scope, container));
  await app.register(async (scope) => capabilityRoutes(scope, container));
  await app.register(async (scope) => proposalRoutes(scope, container));
  await app.register(async (scope) => agentRoutes(scope, container));
  await app.register(async (scope) => domainRoutes(scope, container));
  await app.register(async (scope) => importRoutes(scope, container));
  await app.register(async (scope) => settingsRoutes(scope, container));
}
