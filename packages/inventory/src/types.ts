/** docs/mvp/05-inventory.md, "Inventory Ledger". */
export type MovementType = "OPENING_BALANCE" | "MANUAL_ADJUSTMENT" | "INVOICE_OUT" | "INVOICE_REVERSAL";

export type MovementDirection = "IN" | "OUT";

/** One ledger entry. Written only by `InventoryRepository.recordMovement`. */
export interface MovementInput {
  warehouseId: string;
  productId: string;
  movementType: MovementType;
  direction: MovementDirection;
  /** Always positive: `direction` carries the sign. */
  quantity: string;
  /** Where the movement came from, e.g. "proposal:<id>" or "invoice:<id>". */
  source: string;
  actorId?: string | null;
  changesetId?: string | null;
  reason?: string | null;
}

export interface PrepareAdjustmentInput {
  warehouseId?: string;
  productId: string;
  /** The counted quantity the stock should end up at, never a delta. */
  countedQuantity: string;
  /** Required: docs/mvp/08-agent.md's inventory correction flow demands one. */
  reason: string;
  movementType?: Extract<MovementType, "MANUAL_ADJUSTMENT" | "OPENING_BALANCE">;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouseCode: string;
  quantityOnHand: string;
}

export interface WarehouseInput {
  name: string;
  code: string;
  branchId?: string | null;
  isDefault?: boolean;
}
