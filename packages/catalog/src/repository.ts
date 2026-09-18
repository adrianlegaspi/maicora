import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { ProductInput, ProductPatch, ProductSearchParams } from "./types.js";

export type ProductRow = typeof schema.products.$inferSelect;

/** Maps optional input fields onto a column set, skipping keys the caller omitted. */
function toColumns(input: ProductPatch): Partial<typeof schema.products.$inferInsert> {
  const columns: Partial<typeof schema.products.$inferInsert> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.kind !== undefined) columns.kind = input.kind;
  if (input.description !== undefined) columns.description = input.description;
  if (input.isActive !== undefined) columns.isActive = input.isActive;
  if (input.salePrice !== undefined) columns.salePrice = input.salePrice;
  if (input.currency !== undefined) columns.currency = input.currency;
  if (input.taxRate !== undefined) columns.taxRate = input.taxRate;
  if (input.satProductCode !== undefined) columns.satProductCode = input.satProductCode;
  if (input.internalUnit !== undefined) columns.internalUnit = input.internalUnit;
  if (input.satUnitCode !== undefined) columns.satUnitCode = input.satUnitCode;
  if (input.trackInventory !== undefined) columns.trackInventory = input.trackInventory;
  return columns;
}

export class CatalogRepository {
  constructor(private readonly db: DbClient) {}

  async get(scope: TenantScope, productId: string): Promise<ProductRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.id, productId)))
      .limit(1);
    return row ?? null;
  }

  async getBySku(scope: TenantScope, sku: string): Promise<ProductRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.sku, sku)))
      .limit(1);
    return row ?? null;
  }

  async search(scope: TenantScope, params: ProductSearchParams = {}): Promise<ProductRow[]> {
    const filters: (SQL | undefined)[] = [eq(schema.products.tenantId, scope.tenantId)];
    if (!params.includeInactive) filters.push(eq(schema.products.isActive, true));
    if (params.kind) filters.push(eq(schema.products.kind, params.kind));
    if (params.trackInventoryOnly) filters.push(eq(schema.products.trackInventory, true));
    if (params.query) {
      const term = `%${params.query}%`;
      filters.push(
        or(
          ilike(schema.products.sku, term),
          ilike(schema.products.name, term),
          ilike(schema.products.description, term),
        ),
      );
    }

    return this.db
      .select()
      .from(schema.products)
      .where(and(...filters))
      .orderBy(schema.products.name)
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);
  }

  async insert(scope: TenantScope, input: ProductInput): Promise<ProductRow> {
    const [row] = await this.db
      .insert(schema.products)
      .values({ ...toColumns(input), id: newId(), tenantId: scope.tenantId, sku: input.sku, name: input.name })
      .returning();
    if (!row) throw new Error("Failed to insert product");
    return row;
  }

  async update(scope: TenantScope, productId: string, patch: ProductPatch): Promise<ProductRow | null> {
    const [row] = await this.db
      .update(schema.products)
      .set({ ...toColumns(patch), updatedAt: new Date() })
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.id, productId)))
      .returning();
    return row ?? null;
  }
}
