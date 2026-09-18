import { and, asc, eq, isNull, or } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, ValidationError, type ActorContext } from "@maicora/shared";

/**
 * docs/mvp/08-agent.md scopes memory conservatively: preferences and
 * terminology, never authoritative business facts. An allowlist is how that
 * is enforced - an agent that decides to "remember" a stock level is refused
 * rather than trusted, because a remembered quantity would outlive the truth.
 */
export const MEMORY_KEYS = {
  PREFERRED_WAREHOUSE: "preferred_warehouse",
  TERMINOLOGY: "terminology",
  PRICING_PREFERENCES: "pricing_preferences",
  TARGET_MARGIN: "target_margin",
  FISCAL_PREFERENCES: "fiscal_preferences",
  DISPLAY_PREFERENCES: "display_preferences",
} as const;

export type MemoryKey = (typeof MEMORY_KEYS)[keyof typeof MEMORY_KEYS];

const ALLOWED_KEYS: string[] = Object.values(MEMORY_KEYS);

export interface MemoryEntry {
  key: string;
  value: unknown;
  /** True when the entry belongs to the whole tenant rather than one user. */
  shared: boolean;
}

export class MemoryService {
  constructor(private readonly db: DbClient) {}

  /** This user's memories plus the tenant-wide ones, for the system prompt. */
  async list(actor: ActorContext): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.agentMemory)
      .where(
        and(
          eq(schema.agentMemory.tenantId, actor.tenantId),
          or(eq(schema.agentMemory.userId, actor.userId), isNull(schema.agentMemory.userId)),
        ),
      )
      .orderBy(asc(schema.agentMemory.key));

    return rows.map((row) => ({ key: row.key, value: row.value, shared: row.userId === null }));
  }

  async remember(
    actor: ActorContext,
    key: string,
    value: unknown,
    options: { shared?: boolean } = {},
  ): Promise<void> {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError(`Memory key ${key} is not one Maicora stores`, { allowed: ALLOWED_KEYS });
    }
    const userId = options.shared ? null : actor.userId;

    await this.db
      .insert(schema.agentMemory)
      .values({ id: newId(), tenantId: actor.tenantId, userId, key, value })
      .onConflictDoUpdate({
        target: [schema.agentMemory.tenantId, schema.agentMemory.userId, schema.agentMemory.key],
        set: { value, updatedAt: new Date() },
      });
  }

  async forget(actor: ActorContext, key: string, options: { shared?: boolean } = {}): Promise<void> {
    const userId = options.shared ? null : actor.userId;
    await this.db
      .delete(schema.agentMemory)
      .where(
        and(
          eq(schema.agentMemory.tenantId, actor.tenantId),
          userId === null ? isNull(schema.agentMemory.userId) : eq(schema.agentMemory.userId, userId),
          eq(schema.agentMemory.key, key),
        ),
      );
  }
}
