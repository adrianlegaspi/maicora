import { and, arrayContains, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { CustomerInput, CustomerPatch, CustomerSearchParams } from "./types.js";

export type CustomerRow = typeof schema.customers.$inferSelect;

/** Maps optional input fields onto a column set, skipping keys the caller omitted. */
function toColumns(input: CustomerPatch): Partial<typeof schema.customers.$inferInsert> {
  const columns: Partial<typeof schema.customers.$inferInsert> = {};
  if (input.displayName !== undefined) columns.displayName = input.displayName;
  if (input.kind !== undefined) columns.kind = input.kind;
  if (input.branchId !== undefined) columns.branchId = input.branchId;
  if (input.legalName !== undefined) columns.legalName = input.legalName;
  if (input.rfc !== undefined) columns.rfc = input.rfc;
  if (input.taxRegime !== undefined) columns.taxRegime = input.taxRegime;
  if (input.fiscalPostalCode !== undefined) columns.fiscalPostalCode = input.fiscalPostalCode;
  if (input.cfdiUseDefault !== undefined) columns.cfdiUseDefault = input.cfdiUseDefault;
  if (input.email !== undefined) columns.email = input.email;
  if (input.phone !== undefined) columns.phone = input.phone;
  if (input.notes !== undefined) columns.notes = input.notes;
  if (input.tags !== undefined) columns.tags = input.tags;
  return columns;
}

export class CustomerRepository {
  constructor(private readonly db: DbClient) {}

  async get(scope: TenantScope, customerId: string): Promise<CustomerRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, scope.tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    return row ?? null;
  }

  async search(scope: TenantScope, params: CustomerSearchParams = {}): Promise<CustomerRow[]> {
    const filters: (SQL | undefined)[] = [eq(schema.customers.tenantId, scope.tenantId)];
    if (!params.includeArchived) filters.push(eq(schema.customers.isArchived, false));
    if (params.kind) filters.push(eq(schema.customers.kind, params.kind));
    if (params.tag) filters.push(arrayContains(schema.customers.tags, [params.tag]));
    if (params.query) {
      const term = `%${params.query}%`;
      filters.push(
        or(
          ilike(schema.customers.displayName, term),
          ilike(schema.customers.legalName, term),
          ilike(schema.customers.rfc, term),
          ilike(schema.customers.email, term),
        ),
      );
    }

    return this.db
      .select()
      .from(schema.customers)
      .where(and(...filters))
      .orderBy(schema.customers.displayName)
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);
  }

  async listInvoices(scope: TenantScope, customerId: string, limit = 50) {
    return this.db
      .select({
        id: schema.invoices.id,
        kind: schema.invoices.kind,
        status: schema.invoices.status,
        currency: schema.invoices.currency,
        total: schema.invoices.total,
        uuidFiscal: schema.invoices.uuidFiscal,
        stampedAt: schema.invoices.stampedAt,
        createdAt: schema.invoices.createdAt,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.tenantId, scope.tenantId), eq(schema.invoices.customerId, customerId)))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(limit);
  }

  async insert(scope: TenantScope, input: CustomerInput, actorId: string): Promise<CustomerRow> {
    const [row] = await this.db
      .insert(schema.customers)
      .values({
        ...toColumns(input),
        id: newId(),
        tenantId: scope.tenantId,
        displayName: input.displayName,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();
    if (!row) throw new Error("Failed to insert customer");
    return row;
  }

  async update(scope: TenantScope, customerId: string, patch: CustomerPatch, actorId: string): Promise<CustomerRow> {
    const [row] = await this.db
      .update(schema.customers)
      .set({ ...toColumns(patch), updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(schema.customers.tenantId, scope.tenantId), eq(schema.customers.id, customerId)))
      .returning();
    if (!row) throw new Error(`Customer ${customerId} not found for update`);
    return row;
  }

  async setArchived(scope: TenantScope, customerId: string, isArchived: boolean, actorId: string): Promise<void> {
    await this.db
      .update(schema.customers)
      .set({ isArchived, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(schema.customers.tenantId, scope.tenantId), eq(schema.customers.id, customerId)));
  }
}
