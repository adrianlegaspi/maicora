import { createHash } from "node:crypto";
import { SignJWT } from "jose";

/**
 * A local sign-in that does not need a Supabase project.
 *
 * Production authentication is Supabase Auth, proxied by the backend
 * (docs/mvp/02-platform-foundation.md). But the whole stack - agent,
 * proposals, CFDI sandbox - is meant to be runnable from a clone, and
 * standing up GoTrue first is a steep first step for someone evaluating it.
 * This mints a token in exactly the shape Supabase issues, signed with the
 * same secret the API already verifies, so nothing downstream knows the
 * difference.
 *
 * ponytail: password-free by design - it trusts whatever email it is given.
 * It is refused unless AUTH_DEV_LOGIN is explicitly on and NODE_ENV is not
 * production; point SUPABASE_URL at a real project to replace it.
 */
export async function issueDevToken(
  email: string,
  secret: string,
  options: { audience?: string; ttlSeconds?: number } = {},
): Promise<{ accessToken: string; userId: string; expiresIn: number }> {
  const userId = deterministicUserId(email);
  const expiresIn = options.ttlSeconds ?? 60 * 60 * 12;

  const accessToken = await new SignJWT({ email, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(new TextEncoder().encode(secret));

  return { accessToken, userId, expiresIn };
}

/** Same email, same user id across restarts, so memberships survive a reboot. */
function deterministicUserId(email: string): string {
  const hex = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
  // Stamped as a v4-shaped UUID because the `users.id` column is a uuid.
  const v4 = `${hex.slice(0, 12)}4${hex.slice(13, 16)}a${hex.slice(17, 32)}`;
  return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}
