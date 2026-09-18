import { Decimal } from "decimal.js";
import type { ActorContext } from "@maicora/shared";
import { ConflictError, NotFoundError, ValidationError } from "@maicora/shared";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@maicora/database";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { BusinessDiff, Executor, ProposalRecord, ProposalService } from "@maicora/proposals";
import { InventoryRepository, type MovementRow, type WarehouseRow } from "./repository.js";
import type { PrepareAdjustmentInput, StockLevel, WarehouseInput } from "./types.js";

/** Trims the trailing zeros Postgres numerics carry, so diffs read "54" not "54.000000". */
function qty(value: string): string {
  return new Decimal(value).toString();
}

export class InventoryService {
  constructor(
    private readonly db: Database,
    private readonly proposals: ProposalService,
  ) {}

  async listWarehouses(actor: ActorContext): Promise<WarehouseRow[]> {
    assertPermission(actor, PERMISSIONS.INVENTORY_READ);
    return new InventoryRepository(this.db).listWarehouses(actor);
  }

  /**
   * Warehouses are catalog-shaped setup rather than stock movement, so they
   * reuse PRODUCTS_WRITE instead of an inventory-specific permission.
   */
  async createWarehouse(actor: ActorContext, input: WarehouseInput): Promise<WarehouseRow> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_WRITE);
    if (!input.code?.trim()) throw new ValidationError("A warehouse needs a code", { field: "code" });
    if (!input.name?.trim()) throw new ValidationError("A warehouse needs a name", { field: "name" });

    const repo = new InventoryRepository(this.db);
    if ((await repo.listWarehouses(actor)).some((w) => w.code === input.code.trim())) {
      throw new ConflictError(`A warehouse with code ${input.code} already exists`, { code: input.code });
    }
    return repo.insertWarehouse(actor, { ...input, code: input.code.trim(), name: input.name.trim() });
  }

  async getStock(
    actor: ActorContext,
    params: { warehouseId?: string; productId?: string } = {},
  ): Promise<StockLevel[]> {
    assertPermission(actor, PERMISSIONS.INVENTORY_READ);
    return new InventoryRepository(this.db).listStock(actor, params);
  }

  async getMovements(
    actor: ActorContext,
    params: { productId?: string; warehouseId?: string; limit?: number } = {},
  ): Promise<MovementRow[]> {
    assertPermission(actor, PERMISSIONS.INVENTORY_READ);
    return new InventoryRepository(this.db).listMovements(actor, params);
  }

  async findLowStock(actor: ActorContext, threshold = "5", warehouseId?: string): Promise<StockLevel[]> {
    assertPermission(actor, PERMISSIONS.INVENTORY_READ);
    return new InventoryRepository(this.db).listLowStock(actor, threshold, warehouseId);
  }

  /**
   * Drafts the inventory correction from docs/mvp/08-agent.md: read stock,
   * compute the adjustment, demand a reason, show a diff, require approval.
   * The payload carries the counted quantity rather than a delta, so the
   * executor recomputes the movement against live stock at approval time.
   */
  async prepareAdjustment(actor: ActorContext, input: PrepareAdjustmentInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.INVENTORY_ADJUST_PROPOSE);
    if (!input.reason?.trim()) {
      throw new ValidationError("An inventory adjustment needs a reason", { field: "reason" });
    }
    const counted = new Decimal(input.countedQuantity);
    if (counted.isNegative()) {
      throw new ValidationError("Counted quantity cannot be negative", { countedQuantity: input.countedQuantity });
    }

    const repo = new InventoryRepository(this.db);
    const warehouseId = input.warehouseId ?? (await repo.getDefaultWarehouse(actor))?.id;
    if (!warehouseId) throw new ValidationError("No warehouse given and no default warehouse exists", {});
    if (!(await repo.getWarehouse(actor, warehouseId))) throw new NotFoundError("Warehouse", warehouseId);

    const product = await this.getTrackedProduct(actor, input.productId);
    const current = await repo.getQuantityOnHand(actor, warehouseId, input.productId);

    return this.proposals.create(actor, {
      kind: "INVENTORY_ADJUSTMENT",
      payload: {
        warehouseId,
        productId: input.productId,
        countedQuantity: counted.toString(),
        reason: input.reason.trim(),
        movementType: input.movementType ?? "MANUAL_ADJUSTMENT",
      },
      diff: adjustmentDiff(product.sku, current, counted.toString(), input.reason.trim()),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  private async getTrackedProduct(actor: ActorContext, productId: string) {
    const [product] = await this.db
      .select({ sku: schema.products.sku, trackInventory: schema.products.trackInventory })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, actor.tenantId), eq(schema.products.id, productId)))
      .limit(1);
    if (!product) throw new NotFoundError("Product", productId);
    if (!product.trackInventory) {
      throw new ValidationError("This product does not track inventory", { productId, sku: product.sku });
    }
    return product;
  }
}

/** Mirrors the "Inventory impact" block in docs/mvp/09-proposals-and-governance.md. */
function adjustmentDiff(sku: string, current: string, counted: string, reason: string): BusinessDiff {
  return {
    title: `Inventory adjustment: ${sku}`,
    sections: [
      { heading: "Inventory impact:", lines: [`${sku}: ${qty(current)} → ${qty(counted)}`] },
      { lines: [`Reason: ${reason}`] },
      { changes: [{ label: "Quantity on hand", before: qty(current), after: qty(counted) }] },
    ],
  };
}

/**
 * Applies an approved INVENTORY_ADJUSTMENT by posting one ledger movement.
 * The delta is recomputed here, inside the transaction, so a stock change
 * between drafting and approval cannot make the count land on a stale number.
 * Register with `registry.register("INVENTORY_ADJUSTMENT", inventoryAdjustmentExecutor)`.
 */
export const inventoryAdjustmentExecutor: Executor = async ({ tx, actor, payload, proposalId, changesetId }) => {
  const warehouseId = String(payload.warehouseId);
  const productId = String(payload.productId);
  const counted = new Decimal(String(payload.countedQuantity));

  const repo = new InventoryRepository(tx);
  const current = new Decimal(await repo.getQuantityOnHand(actor, warehouseId, productId));
  const delta = counted.minus(current);

  if (!delta.isZero()) {
    await repo.recordMovement(actor, {
      warehouseId,
      productId,
      movementType: payload.movementType === "OPENING_BALANCE" ? "OPENING_BALANCE" : "MANUAL_ADJUSTMENT",
      direction: delta.isPositive() ? "IN" : "OUT",
      quantity: delta.abs().toString(),
      source: `proposal:${proposalId}`,
      actorId: actor.userId,
      changesetId,
      reason: payload.reason == null ? null : String(payload.reason),
    });
  }

  return {
    entityType: "inventory_balance",
    entityId: productId,
    action: "ADJUST",
    before: { warehouseId, quantityOnHand: current.toString() },
    after: { warehouseId, quantityOnHand: counted.toString() },
    // docs/mvp/09-proposals-and-governance.md lists inventory adjustments as
    // compensatable, not reversible: you undo one by posting another movement.
    reversible: false,
    result: { productId, warehouseId, delta: delta.toString(), quantityOnHand: counted.toString() },
  };
};
