import type { JwtConfig } from "@maicora/auth";
import type { OpenAICompatibleOptions } from "@maicora/agent";
import type { FiscalEnvironment } from "@maicora/cfdi";

export interface Config {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  jwt: JwtConfig;
  supabase?: { url: string; apiKey: string };
  /** Local sign-in without a Supabase project; refused when NODE_ENV=production. */
  devLogin?: { secret: string };
  ai?: OpenAICompatibleOptions;
  fiscalEngineUrl?: string;
  fiscalEngineSecret?: string;
  fiscalEnvironment: FiscalEnvironment;
  logLevel: string;
}

/**
 * Configuration is read once at startup and fails fast: a server that boots
 * without a database or a way to verify tokens would only fail later, per
 * request, with a worse message. Optional integrations (AI, fiscal engine)
 * degrade instead - see `buildContainer`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const jwt: JwtConfig = {
    secret: env.SUPABASE_JWT_SECRET,
    jwksUrl: env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json` : undefined,
    audience: env.SUPABASE_JWT_AUDIENCE,
  };
  // A symmetric secret wins when both are present: it is what a self-hosted
  // GoTrue issues, and mixing the two would verify against the wrong key.
  if (jwt.secret) jwt.jwksUrl = undefined;
  if (!jwt.secret && !jwt.jwksUrl) {
    throw new Error("Set SUPABASE_JWT_SECRET (or SUPABASE_URL) so access tokens can be verified");
  }

  const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, "");
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const devLoginRequested = env.AUTH_DEV_LOGIN === "true" && env.NODE_ENV !== "production";

  const aiApi = env.AI_API;
  const aiKey = env.AI_API_KEY;
  const aiModel = env.AI_MODEL;

  return {
    port: Number(env.API_PORT ?? 4000),
    databaseUrl,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((origin) => origin.trim()),
    jwt,
    supabase:
      supabaseUrl && supabaseKey && supabaseKey !== "replace-me"
        ? { url: supabaseUrl, apiKey: supabaseKey }
        : undefined,
    devLogin: devLoginRequested && jwt.secret ? { secret: jwt.secret } : undefined,
    ai:
      aiApi && aiKey && aiModel && aiKey !== "replace-me"
        ? { baseUrl: aiApi, apiKey: aiKey, model: aiModel }
        : undefined,
    fiscalEngineUrl: env.FISCAL_ENGINE_URL,
    fiscalEngineSecret: env.FISCAL_ENGINE_SHARED_SECRET,
    fiscalEnvironment: env.FISCAL_ENVIRONMENT === "production" ? "PRODUCTION" : "SANDBOX",
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
