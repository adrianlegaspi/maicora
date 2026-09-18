import { describe, expect, it } from "vitest";
import { permissionsForRole, PERMISSIONS } from "./permissions.js";
import { assertPermission } from "./guard.js";
import { ForbiddenError, type ActorContext } from "@maicora/shared";

function actorWithRole(role: keyof typeof roleFixtures): ActorContext {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    membershipId: "membership-1",
    roles: [role],
    permissions: roleFixtures[role],
  };
}

const roleFixtures = {
  OWNER: permissionsForRole("OWNER"),
  ADMIN: permissionsForRole("ADMIN"),
  STAFF: permissionsForRole("STAFF"),
  VIEWER: permissionsForRole("VIEWER"),
};

describe("permissionsForRole", () => {
  it("grants OWNER every permission", () => {
    expect(roleFixtures.OWNER.has(PERMISSIONS.PROPOSALS_APPROVE)).toBe(true);
    expect(roleFixtures.OWNER.has(PERMISSIONS.TENANT_MANAGE)).toBe(true);
  });

  it("does not let STAFF approve or reject proposals", () => {
    expect(roleFixtures.STAFF.has(PERMISSIONS.PROPOSALS_APPROVE)).toBe(false);
    expect(roleFixtures.STAFF.has(PERMISSIONS.PROPOSALS_REJECT)).toBe(false);
  });

  it("lets STAFF draft invoices and propose inventory adjustments but not approve them", () => {
    expect(roleFixtures.STAFF.has(PERMISSIONS.INVOICES_DRAFT)).toBe(true);
    expect(roleFixtures.STAFF.has(PERMISSIONS.INVENTORY_ADJUST_PROPOSE)).toBe(true);
    expect(roleFixtures.STAFF.has(PERMISSIONS.PROPOSALS_APPROVE)).toBe(false);
  });

  it("restricts VIEWER to read-only permissions", () => {
    for (const permission of roleFixtures.VIEWER) {
      expect(permission.endsWith(".read")).toBe(true);
    }
  });
});

describe("assertPermission", () => {
  it("throws ForbiddenError when the actor lacks the permission", () => {
    const viewer = actorWithRole("VIEWER");
    expect(() => assertPermission(viewer, PERMISSIONS.PROPOSALS_APPROVE)).toThrow(ForbiddenError);
  });

  it("does not throw when the actor has the permission", () => {
    const admin = actorWithRole("ADMIN");
    expect(() => assertPermission(admin, PERMISSIONS.PROPOSALS_APPROVE)).not.toThrow();
  });
});
