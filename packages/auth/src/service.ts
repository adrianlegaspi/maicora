import { and, asc, eq } from "drizzle-orm";
import { schema, type Database } from "@maicora/database";
import { ForbiddenError, NotFoundError, ValidationError, newId, type ActorContext } from "@maicora/shared";
import { PERMISSIONS, assertPermission, permissionsForRole, type MembershipRole } from "@maicora/tenancy";
import type { AuthenticatedUser } from "./jwt.js";

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  membershipId: string;
  role: MembershipRole;
}


export interface TenantMember {
  membershipId: string;
  userId: string;
  email: string;
  role: MembershipRole;
  isActive: boolean;
}

export class AuthService {
  constructor(private readonly db: Database) {}

  /**
   * Mirrors the Supabase user into the local `users` table on first sight, so
   * joins and display names work without calling Supabase on every request.
   * Supabase stays the source of truth for credentials; this row holds none.
   */
  async syncUser(user: AuthenticatedUser): Promise<void> {
    await this.db
      .insert(schema.users)
      .values({ id: user.userId, email: user.email })
      .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email } });
  }

  /** The companies this user may act in - the tenant switcher's data. */
  async listMemberships(userId: string): Promise<TenantMembership[]> {
    const rows = await this.db
      .select({
        tenantId: schema.tenants.id,
        tenantName: schema.tenants.name,
        tenantSlug: schema.tenants.slug,
        membershipId: schema.tenantMemberships.id,
        role: schema.tenantMemberships.role,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
      .where(
        and(
          eq(schema.tenantMemberships.userId, userId),
          eq(schema.tenantMemberships.isActive, true),
        ),
      )
      .orderBy(asc(schema.tenants.name));

    return rows;
  }

  /**
   * Builds the ActorContext every domain call is scoped by. The tenant comes
   * from the request, but the membership is what authorises it: a user who
   * names a tenant they do not belong to gets a 403, never a silent fallback
   * to some other tenant (non-negotiable #8).
   */
  async resolveActor(user: AuthenticatedUser, tenantId: string): Promise<ActorContext> {
    const [membership] = await this.db
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.userId, user.userId),
          eq(schema.tenantMemberships.tenantId, tenantId),
          eq(schema.tenantMemberships.isActive, true),
        ),
      )
      .limit(1);
    if (!membership) throw new ForbiddenError("No active membership for this tenant");

    const [branch] = await this.db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(and(eq(schema.branches.tenantId, tenantId), eq(schema.branches.isDefault, true)))
      .limit(1);

    return {
      tenantId,
      branchId: branch?.id,
      userId: user.userId,
      membershipId: membership.id,
      roles: [membership.role],
      permissions: permissionsForRole(membership.role),
    };
  }

  /**
   * Creates a company and makes the caller its OWNER. This is the one write
   * that cannot require a tenant permission: the tenant does not exist yet.
   */
  async createTenant(userId: string, input: { name: string; slug: string }): Promise<TenantMembership> {
    return this.db.transaction(async (tx) => {
      const tenantId = newId();
      await tx.insert(schema.tenants).values({ id: tenantId, name: input.name, slug: input.slug });
      await tx
        .insert(schema.branches)
        .values({ id: newId(), tenantId, name: "Main", code: "MAIN", isDefault: true });

      const membershipId = newId();
      await tx
        .insert(schema.tenantMemberships)
        .values({ id: membershipId, tenantId, userId, role: "OWNER" });

      return {
        tenantId,
        tenantName: input.name,
        tenantSlug: input.slug,
        membershipId,
        role: "OWNER" as const,
      };
    });
  }

  /** Screen 21 (Tenant/user/permission settings). */
  async listMembers(actor: ActorContext): Promise<TenantMember[]> {
    assertPermission(actor, PERMISSIONS.USERS_MANAGE);

    return this.db
      .select({
        membershipId: schema.tenantMemberships.id,
        userId: schema.users.id,
        email: schema.users.email,
        role: schema.tenantMemberships.role,
        isActive: schema.tenantMemberships.isActive,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
      .where(eq(schema.tenantMemberships.tenantId, actor.tenantId))
      .orderBy(asc(schema.users.email));
  }

  /**
   * Adds someone who has already signed in at least once. There is no invite
   * flow in the MVP: the user row is mirrored from Supabase on first request,
   * so an unknown email means "they have not signed in yet", not "typo".
   */
  async addMember(actor: ActorContext, email: string, role: MembershipRole): Promise<TenantMember> {
    assertPermission(actor, PERMISSIONS.USERS_MANAGE);

    const [user] = await this.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!user) {
      throw new ValidationError(`No user has signed in with ${email} yet; ask them to sign in once first`);
    }

    const membershipId = newId();
    const [row] = await this.db
      .insert(schema.tenantMemberships)
      .values({ id: membershipId, tenantId: actor.tenantId, userId: user.id, role })
      .onConflictDoUpdate({
        target: [schema.tenantMemberships.tenantId, schema.tenantMemberships.userId],
        set: { role, isActive: true },
      })
      .returning({ id: schema.tenantMemberships.id, isActive: schema.tenantMemberships.isActive });

    return { membershipId: row!.id, userId: user.id, email: user.email, role, isActive: row!.isActive };
  }

  /**
   * Changes a role or deactivates a member. An actor may not edit their own
   * membership: the only way to lose access to a company you administer
   * should be someone else taking it, never a mis-click that locks the
   * company's last owner out of it.
   */
  async updateMember(
    actor: ActorContext,
    membershipId: string,
    patch: { role?: MembershipRole; isActive?: boolean },
  ): Promise<TenantMember> {
    assertPermission(actor, PERMISSIONS.USERS_MANAGE);
    if (membershipId === actor.membershipId) {
      throw new ValidationError("You cannot change your own role or access; ask another owner to do it");
    }

    const [updated] = await this.db
      .update(schema.tenantMemberships)
      .set(patch)
      .where(
        and(
          eq(schema.tenantMemberships.id, membershipId),
          eq(schema.tenantMemberships.tenantId, actor.tenantId),
        ),
      )
      .returning({
        membershipId: schema.tenantMemberships.id,
        userId: schema.tenantMemberships.userId,
        role: schema.tenantMemberships.role,
        isActive: schema.tenantMemberships.isActive,
      });
    if (!updated) throw new NotFoundError("Membership", membershipId);

    const [user] = await this.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, updated.userId))
      .limit(1);

    return { ...updated, email: user?.email ?? "" };
  }
}
