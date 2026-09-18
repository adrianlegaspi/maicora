import { and, asc, desc, eq, lte, sql, type SQL } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { MovementInput, StockLevel, WarehouseInput } from "./types.js";

export type WarehouseRow = typeof schema.warehouses.$inferSelect;
export type MovementRow = typeof schema.inventoryMovements.$inferSelect;

export class InventoryRepository {
  constructor(private readonly db: DbClient) {}

  async listWarehouses(scope: TenantScope): Promise<WarehouseRow[]> {
    return this.db
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.tenantId, scope.tenantId), eq(schema.warehouses.isActive, true)))
      .orderBy(asc(schema.warehouses.code));
  }

  async getDefaultWarehouse(scope: TenantScope): Promise<WarehouseRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.warehouses)
      .where(
        and(
          eq(schema.warehouses.tenantId, scope.tenantId),
          eq(schema.warehouses.isActive, true),
          eq(schema.warehouses.isDefault, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getWarehouse(scope: TenantScope, warehouseId: string): Promise<WarehouseRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.tenantId, scope.tenantId), eq(schema.warehouses.id, warehouseId)))
      .limit(1);
    return row ?? null;
  }

  async insertWarehouse(scope: TenantScope, input: WarehouseInput): Promise<WarehouseRow> {
    const [row] = await this.db
      .insert(schema.warehouses)
      .values({
        id: newId(),
        tenantId: scope.tenantId,
        branchId: input.branchId ?? null,
        name: input.name,
        code: input.code,
        isDefault: input.isDefault ?? false,
      })
      .returning();
    if (!row) throw new Error("Failed to insert warehouse");
    return row;
  }

  /** Current quantity on hand, or "0" when the product has never moved. */
  async getQuantityOnHand(scope: TenantScope, warehouseId: string, productId: string): Promise<string> {
    const [row] = await this.db
      .select({ quantityOnHand: schema.inventoryBalances.quantityOnHand })
      .from(schema.inventoryBalances)
      .where(
        and(
          eq(schema.inventoryBalances.tenantId, scope.tenantId),
          eq(schema.inventoryBalances.warehouseId, warehouseId),
          eq(schema.inventoryBalances.productId, productId),
        ),
      )
      .limit(1);
    return row?.quantityOnHand ?? "0";
  }

  async listStock(
    scope: TenantScope,
    params: { warehouseId?: string; productId?: string } = {},
  ): Promise<StockLevel[]> {
    const filters: (SQL | undefined)[] = [eq(schema.inventoryBalances.tenantId, scope.tenantId)];
    if (params.warehouseId) filters.push(eq(schema.inventoryBalances.warehouseId, params.warehouseId));
    if (params.productId) filters.push(eq(schema.inventoryBalances.productId, params.productId));

    return this.stockQuery(and(...filters));
  }

  /**
   * Products at or below `threshold` in any warehouse. The threshold is a
   * query parameter rather than a per-product reorder point: the MVP model
   * has no such column (docs/mvp/04-core-domains.md).
   */
  async listLowStock(scope: TenantScope, threshold: string, warehouseId?: string): Promise<StockLevel[]> {
    const filters: (SQL | undefined)[] = [
      eq(schema.inventoryBalances.tenantId, scope.tenantId),
      lte(schema.inventoryBalances.quantityOnHand, threshold),
      eq(schema.products.trackInventory, true),
    ];
    if (warehouseId) filters.push(eq(schema.inventoryBalances.warehouseId, warehouseId));

    return this.stockQuery(and(...filters), asc(schema.inventoryBalances.quantityOnHand));
  }

  private stockQuery(where: SQL | undefined, orderBy?: SQL) {
    return this.db
      .select({
        productId: schema.products.id,
        sku: schema.products.sku,
        name: schema.products.name,
        warehouseId: schema.warehouses.id,
        warehouseCode: schema.warehouses.code,
        quantityOnHand: schema.inventoryBalances.quantityOnHand,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.products, eq(schema.products.id, schema.inventoryBalances.productId))
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.inventoryBalances.warehouseId))
      .where(where)
      .orderBy(orderBy ?? asc(schema.products.sku));
  }

  async listMovements(
    scope: TenantScope,
    params: { productId?: string; warehouseId?: string; limit?: number } = {},
  ): Promise<MovementRow[]> {
    const filters: (SQL | undefined)[] = [eq(schema.inventoryMovements.tenantId, scope.tenantId)];
    if (params.productId) filters.push(eq(schema.inventoryMovements.productId, params.productId));
    if (params.warehouseId) filters.push(eq(schema.inventoryMovements.warehouseId, params.warehouseId));

    return this.db
      .select()
      .from(schema.inventoryMovements)
      .where(and(...filters))
      .orderBy(desc(schema.inventoryMovements.createdAt))
      .limit(params.limit ?? 100);
  }

  /**
   * The only way stock ever changes (non-negotiable #7: "No inventory
   * mutation outside the ledger"). The movement insert and the balance
   * upsert happen in one statement pair, so a caller must pass a transaction
   * client - every caller does, because both proposal execution and invoice
   * stamping already run inside one.
   */
  async recordMovement(scope: TenantScope, input: MovementInput): Promise<MovementRow> {
    const [movement] = await this.db
      .insert(schema.inventoryMovements)
      .values({
        id: newId(),
        tenantId: scope.tenantId,
        warehouseId: input.warehouseId,
        productId: input.productId,
        movementType: input.movementType,
        direction: input.direction,
        quantity: input.quantity,
        source: input.source,
        actorId: input.actorId ?? null,
        changesetId: input.changesetId ?? null,
        reason: input.reason ?? null,
      })
      .returning();
    if (!movement) throw new Error("Failed to insert inventory movement");

    const signed = input.direction === "IN" ? input.quantity : `-${input.quantity}`;
    await this.db
      .insert(schema.inventoryBalances)
      .values({
        id: newId(),
        tenantId: scope.tenantId,
        warehouseId: input.warehouseId,
        productId: input.productId,
        quantityOnHand: signed,
      })
      .onConflictDoUpdate({
        target: [schema.inventoryBalances.warehouseId, schema.inventoryBalances.productId],
        set: {
          quantityOnHand: sql`${schema.inventoryBalances.quantityOnHand} + ${signed}`,
          updatedAt: new Date(),
        },
      });

    return movement;
  }
}
