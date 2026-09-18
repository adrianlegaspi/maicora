import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import { schema } from "@maicora/database";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@maicora/shared";
import { newId, ValidationError } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { InventoryService, inventoryAdjustmentExecutor } from "./service.js";

const dbReachable = await isTestDbReachable();

describe.skipIf(!dbReachable)("InventoryService (integration)", () => {
  const db = getTestDb();
  const registry = new ExecutorRegistry();
  registry.register("INVENTORY_ADJUSTMENT", inventoryAdjustmentExecutor);
  const proposals = new ProposalService(db, registry);
  const inventory = new InventoryService(db, proposals);

  let actor: ActorContext;
  let warehouseId: string;
  let productId: string;

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };

    warehouseId = (await inventory.createWarehouse(actor, { name: "Main", code: "MAIN", isDefault: true })).id;
    productId = newId();
    await db.insert(schema.products).values({
      id: productId,
      tenantId: tenant.tenantId,
      sku: "SKU-991",
      name: "Widget",
      salePrice: "100.00",
    });
  });

  /** Drafts an adjustment and approves + executes it, as the spec's flow does. */
  async function adjustTo(countedQuantity: string, reason = "Physical count") {
    const proposal = await inventory.prepareAdjustment(actor, {
      productId,
      countedQuantity,
      reason,
      idempotencyKey: `adj-${countedQuantity}-${reason}`,
    });
    await proposals.approve(actor, proposal.id);
    return proposals.execute(actor, proposal.id);
  }

  it("drafts the spec's inventory correction and only moves stock after approval", async () => {
    await adjustTo("52", "Opening count");

    const proposal = await inventory.prepareAdjustment(actor, {
      productId,
      countedQuantity: "47",
      reason: "Counted 47 on the shelf",
      idempotencyKey: "adj-991-1",
    });

    expect(proposal.kind).toBe("INVENTORY_ADJUSTMENT");
    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.diff.sections[0]?.lines).toEqual(["SKU-991: 52 → 47"]);

    // Unapproved: stock is untouched.
    const [before] = await inventory.getStock(actor, { productId });
    expect(before?.quantityOnHand).toBe("52.000000");

    await proposals.approve(actor, proposal.id);
    const { changeset } = await proposals.execute(actor, proposal.id);

    const [after] = await inventory.getStock(actor, { productId });
    expect(after?.quantityOnHand).toBe("47.000000");
    // Adjustments are compensatable, not reversible (ch09).
    expect(changeset?.reversible).toBe(false);
  });

  it("writes exactly one ledger movement per adjustment, linked to its ChangeSet", async () => {
    const { changeset } = await adjustTo("52", "Opening count");

    const movements = await inventory.getMovements(actor, { productId });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movementType: "MANUAL_ADJUSTMENT",
      direction: "IN",
      quantity: "52.000000",
      reason: "Opening count",
      changesetId: changeset?.id,
    });

    await adjustTo("47", "Recount");
    const all = await inventory.getMovements(actor, { productId });
    expect(all).toHaveLength(2);
    expect(all[0]?.direction).toBe("OUT");
    expect(all[0]?.quantity).toBe("5.000000");
  });

  // Non-negotiable #7: the balance is derived state, never independently set.
  it("keeps the materialized balance equal to the sum of its ledger movements", async () => {
    await adjustTo("52", "Opening count");
    await adjustTo("47", "Recount");
    await adjustTo("60", "Restock found in back room");

    const movements = await inventory.getMovements(actor, { productId });
    const ledgerTotal = movements.reduce(
      (sum, m) => sum + (m.direction === "IN" ? Number(m.quantity) : -Number(m.quantity)),
      0,
    );

    const [balance] = await inventory.getStock(actor, { productId });
    expect(Number(balance?.quantityOnHand)).toBe(ledgerTotal);
    expect(ledgerTotal).toBe(60);
  });

  it("recomputes the delta against live stock, not the stock seen when drafting", async () => {
    await adjustTo("52", "Opening count");

    // Drafted while stock reads 52.
    const stale = await inventory.prepareAdjustment(actor, {
      productId,
      countedQuantity: "47",
      reason: "Counted 47",
      idempotencyKey: "adj-stale",
    });

    // Stock moves to 50 before the approval lands.
    await adjustTo("50", "Interim correction");

    await proposals.approve(actor, stale.id);
    await proposals.execute(actor, stale.id);

    // The count still wins, and the movement is the 3-unit delta from 50.
    const [balance] = await inventory.getStock(actor, { productId });
    expect(balance?.quantityOnHand).toBe("47.000000");
    const [latest] = await inventory.getMovements(actor, { productId });
    expect(latest?.quantity).toBe("3.000000");
  });

  it("requires a reason and refuses products that do not track inventory", async () => {
    await expect(
      inventory.prepareAdjustment(actor, { productId, countedQuantity: "10", reason: "  ", idempotencyKey: "a" }),
    ).rejects.toBeInstanceOf(ValidationError);

    await db.update(schema.products).set({ trackInventory: false }).where(eq(schema.products.id, productId));
    await expect(
      inventory.prepareAdjustment(actor, { productId, countedQuantity: "10", reason: "count", idempotencyKey: "b" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("finds products at or below a low-stock threshold", async () => {
    await adjustTo("3", "Opening count");

    const lowProductId = newId();
    await db.insert(schema.products).values({
      id: lowProductId,
      tenantId: actor.tenantId,
      sku: "SKU-PLENTY",
      name: "Plentiful",
      salePrice: "10.00",
    });
    const plenty = await inventory.prepareAdjustment(actor, {
      productId: lowProductId,
      countedQuantity: "80",
      reason: "Opening count",
      idempotencyKey: "adj-plenty",
    });
    await proposals.approve(actor, plenty.id);
    await proposals.execute(actor, plenty.id);

    const low = await inventory.findLowStock(actor, "5");
    expect(low.map((l) => l.sku)).toEqual(["SKU-991"]);
    expect(await inventory.findLowStock(actor, "100")).toHaveLength(2);
  });

  it("defaults to the tenant's default warehouse when none is given", async () => {
    await adjustTo("12", "Opening count");
    const [stock] = await inventory.getStock(actor, { productId });
    expect(stock?.warehouseId).toBe(warehouseId);
  });
});
