import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError, type ErrorCode } from "@maicora/shared";
import type { ActorContext } from "@maicora/shared";
import { bearerToken, verifyAccessToken } from "@maicora/auth";
import type { Container } from "./container.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext;
    userId?: string;
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FISCAL_ERROR: 502,
};

/** One mapping from domain errors to HTTP, as `packages/shared/src/errors.ts` intends. */
export function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ZodError) {
    return reply.status(422).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
      },
    });
  }

  if (error instanceof AppError) {
    return reply
      .status(STATUS_BY_CODE[error.code])
      .send({ error: { code: error.code, message: error.message, details: error.details } });
  }

  reply.log.error({ err: error }, "unhandled error");
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Unexpected server error" } });
}

/**
 * Authenticates the request and, when it names a tenant, resolves the actor.
 * The tenant comes from a header rather than the token, because one user
 * belongs to several companies; the membership lookup is what authorises it.
 */
export function authenticate(container: Container) {
  return async (request: FastifyRequest) => {
    const token = bearerToken(request.headers.authorization);
    const user = await verifyAccessToken(token, container.jwt);
    await container.auth.syncUser(user);
    request.userId = user.userId;

    const tenantId = request.headers["x-tenant-id"];
    if (typeof tenantId === "string" && tenantId) {
      request.actor = await container.auth.resolveActor(user, tenantId);
    }
  };
}

/** Routes that act inside a company. Missing header is a 400-shaped validation error. */
export function requireActor(request: FastifyRequest): ActorContext {
  if (!request.actor) {
    throw new AppError("VALIDATION_ERROR", "Select a company first: send an X-Tenant-Id header");
  }
  return request.actor;
}
