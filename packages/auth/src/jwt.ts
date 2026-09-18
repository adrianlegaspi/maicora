import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { UnauthenticatedError } from "@maicora/shared";

/**
 * Supabase Auth is the source of truth for credentials and the backend never
 * stores a password (docs/mvp/02-platform-foundation.md: "Supabase Auth
 * behind backend only"). All this module does is verify the access token the
 * client presents and hand back who it says they are.
 *
 * Supabase issues HS256 tokens signed with the project's JWT secret, and
 * newer projects issue asymmetric tokens verified through JWKS. Both are
 * supported because a self-hoster may be on either.
 */
export interface JwtConfig {
  /** Shared secret for HS256 projects (SUPABASE_JWT_SECRET). */
  secret?: string;
  /** JWKS endpoint for asymmetric projects, e.g. `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. */
  jwksUrl?: string;
  /** Expected `aud` claim; Supabase uses "authenticated" for signed-in users. */
  audience?: string;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrlInUse: string | undefined;

/** Cached across calls: re-fetching the key set on every request would be a self-inflicted rate limit. */
function keySet(url: string) {
  if (!jwks || jwksUrlInUse !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrlInUse = url;
  }
  return jwks;
}

export async function verifyAccessToken(token: string, config: JwtConfig): Promise<AuthenticatedUser> {
  if (!config.secret && !config.jwksUrl) {
    throw new UnauthenticatedError("Auth is not configured: set SUPABASE_JWT_SECRET or SUPABASE_URL");
  }

  let payload: JWTPayload;
  try {
    const options = { audience: config.audience ?? "authenticated" };
    ({ payload } = config.jwksUrl
      ? await jwtVerify(token, keySet(config.jwksUrl), options)
      : await jwtVerify(token, new TextEncoder().encode(config.secret), options));
  } catch (cause) {
    // Never leak why: an invalid signature and an expired token are the same
    // answer to a caller who does not already hold a valid token.
    throw new UnauthenticatedError("Invalid or expired access token");
  }

  const userId = payload.sub;
  if (!userId) throw new UnauthenticatedError("Access token has no subject");

  return { userId, email: typeof payload.email === "string" ? payload.email : `${userId}@unknown.invalid` };
}

/** Pulls the bearer token out of an Authorization header. */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer (.+)$/i.exec(header ?? "");
  if (!match?.[1]) throw new UnauthenticatedError("Missing Authorization: Bearer <token>");
  return match[1];
}
