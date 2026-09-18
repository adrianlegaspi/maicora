/**
 * Roles are a fixed enum for the MVP (mirrors the `membership_role` Postgres
 * enum in packages/database/src/schema/tenancy.ts). The role -> permission
 * mapping lives here, in code, rather than in an editable DB table: it is a
 * security boundary, not a business setting, so it ships typed and
 * reviewable in a diff instead of being editable at runtime.
 */
export type MembershipRole = "OWNER" | "ADMIN" | "STAFF" | "VIEWER";

/**
 * Canonical permission strings. Every capability and API route checks one of
 * these rather than inventing ad hoc string literals at the call site.
 */
export const PERMISSIONS = {
  CUSTOMERS_READ: "customers.read",
  CUSTOMERS_WRITE: "customers.write",
  PRODUCTS_READ: "products.read",
  PRODUCTS_WRITE: "products.write",
  PRICING_READ: "pricing.read",
  PRICING_WRITE: "pricing.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_ADJUST_PROPOSE: "inventory.adjust.propose",
  INVOICES_READ: "invoices.read",
  INVOICES_DRAFT: "invoices.draft",
  PROPOSALS_READ: "proposals.read",
  PROPOSALS_APPROVE: "proposals.approve",
  PROPOSALS_REJECT: "proposals.reject",
  AUDIT_READ: "audit.read",
  FISCAL_SETTINGS_MANAGE: "fiscal.settings.manage",
  TENANT_MANAGE: "tenant.manage",
  USERS_MANAGE: "users.manage",
  AI_SETTINGS_MANAGE: "ai.settings.manage",
  MCP_ACCESS: "mcp.access",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const STAFF_PERMISSIONS: Permission[] = [
  PERMISSIONS.CUSTOMERS_READ,
  PERMISSIONS.CUSTOMERS_WRITE,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.PRODUCTS_WRITE,
  PERMISSIONS.PRICING_READ,
  PERMISSIONS.PRICING_WRITE,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.INVENTORY_ADJUST_PROPOSE,
  PERMISSIONS.INVOICES_READ,
  PERMISSIONS.INVOICES_DRAFT,
  PERMISSIONS.PROPOSALS_READ,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.MCP_ACCESS,
];

const VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.CUSTOMERS_READ,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.PRICING_READ,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.INVOICES_READ,
  PERMISSIONS.PROPOSALS_READ,
  PERMISSIONS.AUDIT_READ,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.PROPOSALS_APPROVE,
  PERMISSIONS.PROPOSALS_REJECT,
  PERMISSIONS.FISCAL_SETTINGS_MANAGE,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.AI_SETTINGS_MANAGE,
];

const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  STAFF: STAFF_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

export function permissionsForRole(role: MembershipRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}
