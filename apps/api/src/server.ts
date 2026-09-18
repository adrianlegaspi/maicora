import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Container } from "./container.js";
import { sendError } from "./http.js";
import { apiRoutes } from "./routes/index.js";
import { sessionRoutes } from "./routes/session.js";

/** Builds the Fastify app; `index.ts` is the only thing that calls `.listen`. */
export async function buildServer(container: Container) {
  const app = Fastify({ logger: { level: container.config.logLevel } });

  await app.register(cors, { origin: container.config.corsOrigins });

  app.get("/healthz", async () => ({ ok: true }));

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  await app.register(async (scope) => sessionRoutes(scope, container), { prefix: "/api" });
  await app.register(async (scope) => apiRoutes(scope, container), { prefix: "/api" });

  return app;
}
