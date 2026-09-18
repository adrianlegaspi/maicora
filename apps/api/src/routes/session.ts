import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, UnauthenticatedError } from "@maicora/shared";
import { issueDevToken } from "@maicora/auth";
import type { Container } from "../container.js";

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/**
 * Screen 1 (Login). These are the only routes outside the authenticated
 * subtree, and the only place a credential is ever seen: the browser posts it
 * here and the backend talks to Supabase, because the frontend is not allowed
 * to hold a Supabase key or call Supabase at all (AGENTS.md).
 */
export function sessionRoutes(app: FastifyInstance, container: Container): void {
  app.post("/auth/login", async (request) => {
    const { email, password } = credentialsSchema.parse(request.body);

    if (container.config.devLogin) {
      const { accessToken, expiresIn } = await issueDevToken(email, container.config.devLogin.secret, {
        audience: container.config.jwt.audience,
      });
      return { accessToken, expiresIn } satisfies Session;
    }

    return supabaseGrant(container, "password", { email, password });
  });

  app.post("/auth/refresh", async (request) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    if (container.config.devLogin) {
      throw new UnauthenticatedError("Dev sign-in issues no refresh token; sign in again");
    }
    return supabaseGrant(container, "refresh_token", { refresh_token: refreshToken });
  });
}

async function supabaseGrant(
  container: Container,
  grantType: "password" | "refresh_token",
  body: Record<string, string>,
): Promise<Session> {
  const supabase = container.config.supabase;
  if (!supabase) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Sign-in is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or AUTH_DEV_LOGIN=true for local use",
    );
  }

  const response = await fetch(`${supabase.url}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: supabase.apiKey },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Supabase distinguishes "no such user" from "wrong password"; the client does not.
    throw new UnauthenticatedError("Those credentials were not accepted");
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in ?? 3600,
  };
}
