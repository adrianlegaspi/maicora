import { and, desc, eq, type SQL } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type ActorContext, type TenantScope } from "@maicora/shared";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";

export type AuditRow = typeof schema.auditLog.$inferSelect;

export interface AuditEvent {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}

/**
 * The security event log (docs/mvp/04-core-domains.md): authentication,
 * tenant switches, permission denials, agent tool calls, MCP calls. ChangeSets
 * record what changed; this records what was attempted, including the attempts
 * that changed nothing.
 */
export class AuditService {
  constructor(private readonly db: DbClient) {}

  /**
   * Writes one event. Pass a transaction to tie the record to the work it
   * describes; pass the pool to record something that happened outside one
   * (a denied permission check has no transaction to join).
   */
  async record(scope: TenantScope, actorId: string | null, event: AuditEvent): Promise<void> {
    await this.db.insert(schema.auditLog).values({
      id: newId(),
      tenantId: scope.tenantId,
      actorId,
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? null,
    });
  }

  /**
   * Audit writes must never take down the request that produced them: a
   * failed log line is worth a console warning, not a 500 on a completed
   * action. Use this from middleware and other fire-and-forget call sites.
   */
  async recordSafely(scope: TenantScope, actorId: string | null, event: AuditEvent): Promise<void> {
    try {
      await this.record(scope, actorId, event);
    } catch (error) {
      console.warn(`[audit] failed to record ${event.action}:`, error);
    }
  }

  async list(actor: ActorContext, query: AuditQuery = {}): Promise<AuditRow[]> {
    assertPermission(actor, PERMISSIONS.AUDIT_READ);

    const filters: (SQL | undefined)[] = [eq(schema.auditLog.tenantId, actor.tenantId)];
    if (query.action) filters.push(eq(schema.auditLog.action, query.action));
    if (query.entityType) filters.push(eq(schema.auditLog.entityType, query.entityType));
    if (query.entityId) filters.push(eq(schema.auditLog.entityId, query.entityId));

    return this.db
      .select()
      .from(schema.auditLog)
      .where(and(...filters))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(query.limit ?? 100)
      .offset(query.offset ?? 0);
  }
}
