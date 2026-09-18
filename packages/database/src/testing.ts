import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "./client.js";
import * as schema from "./schema/index.js";
import { newId } from "@maicora/shared";

/**
 * Shared integration-test helpers. Tests that need a real Postgres connect
 * to a dedicated `maicora_test` database (never the dev database) via
 * DATABASE_URL_TEST, and should skip gracefully when it isn't reachable
 * (e.g. a fresh clone before `docker compose up` has run).
 */
export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL_TEST ?? "postgres://maicora:maicora@localhost:5433/maicora_test";
}

let db: Database | undefined;

export function getTestDb(): Database {
  if (!db) db = createDatabase(testDatabaseUrl());
  return db;
}

export async function isTestDbReachable(): Promise<boolean> {
  try {
    await getTestDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Deletes all rows in FK-safe order. Keeps tests independent without recreating the schema each time. */
export async function truncateAll(database: Database): Promise<void> {
  await database.execute(sql`
    truncate table
      agent_messages, agent_conversations, agent_memory,
      audit_log,
      changesets, proposals,
      invoice_items, invoices, fiscal_settings,
      inventory_movements, inventory_balances, warehouses,
      cost_components, cost_models,
      products,
      customer_addresses, customer_contacts, customers,
      tenant_memberships, users, branches, tenants
    restart identity cascade
  `);
}

export interface SeededTenant {
  tenantId: string;
  userId: string;
  membershipId: string;
  branchId: string;
}

/** Creates a tenant, a default branch, a user, and an OWNER membership. */
export async function seedTenant(database: Database, overrides?: { tenantName?: string; userEmail?: string }): Promise<SeededTenant> {
  const tenantId = newId();
  const userId = newId();
  const membershipId = newId();
  const branchId = newId();

  await database.insert(schema.tenants).values({
    id: tenantId,
    name: overrides?.tenantName ?? "Test Tenant",
    slug: `test-tenant-${tenantId.slice(0, 8)}`,
  });
  await database.insert(schema.branches).values({
    id: branchId,
    tenantId,
    name: "Main",
    code: "MAIN",
    isDefault: true,
  });
  await database.insert(schema.users).values({
    id: userId,
    email: overrides?.userEmail ?? `${userId.slice(0, 8)}@example.com`,
  });
  await database.insert(schema.tenantMemberships).values({
    id: membershipId,
    tenantId,
    userId,
    role: "OWNER",
  });

  return { tenantId, userId, membershipId, branchId };
}
