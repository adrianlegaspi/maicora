/**
 * Every domain repository/service call is scoped by an ActorContext. This is
 * the mechanism behind non-negotiable #8 ("No unscoped tenant repositories"):
 * a repository method that does not take a TenantScope should not exist, and
 * every query built from one must include `tenantId` in its WHERE clause.
 *
 * The API layer constructs this once per request from the verified Supabase
 * JWT plus the active tenant membership, and passes it down explicitly
 * (never via ambient/global state) so it can never be forgotten or spoofed
 * mid-request.
 */
export interface TenantScope {
  readonly tenantId: string;
  /** Optional: most MVP tenants use a single branch, but the column always exists. */
  readonly branchId?: string;
}

export interface ActorContext extends TenantScope {
  readonly userId: string;
  readonly membershipId: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
}

export function hasPermission(actor: ActorContext, permission: string): boolean {
  return actor.permissions.has(permission) || actor.permissions.has("*");
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}
