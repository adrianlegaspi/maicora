import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import type { ActorContext } from "@maicora/shared";
import { ConflictError, ValidationError } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { CatalogService } from "./service.js";

const dbReachable = await isTestDbReachable();

describe.skipIf(!dbReachable)("CatalogService (integration)", () => {
  const db = getTestDb();
  const catalog = new CatalogService(db);

  let actor: ActorContext;

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };
  });

  it("creates a product with the spec's minimum model and SAT fields", async () => {
    const product = await catalog.create(actor, {
      sku: "FIG-DRAGON-XL",
      name: "Figure Dragon XL",
      description: "Resin figure, 30cm",
      salePrice: "230.00",
      taxRate: "0.16",
      satProductCode: "01010101",
      internalUnit: "pza",
      satUnitCode: "H87",
    });

    expect(product.kind).toBe("PRODUCT");
    expect(product.isActive).toBe(true);
    expect(product.trackInventory).toBe(true);
    expect(product.salePrice).toBe("230.000000");
    expect(product.taxRate).toBe("0.1600");
    expect(product.satUnitCode).toBe("H87");
  });

  // "Services remain valid invoice items even when inventory tracking is
  // disabled" (docs/mvp/04-core-domains.md).
  it("opts services out of inventory tracking by default", async () => {
    const service = await catalog.create(actor, { sku: "SRV-DESIGN", name: "Design hour", kind: "SERVICE" });
    expect(service.trackInventory).toBe(false);

    const tracked = await catalog.create(actor, {
      sku: "SRV-RENTAL",
      name: "Equipment rental",
      kind: "SERVICE",
      trackInventory: true,
    });
    expect(tracked.trackInventory).toBe(true);
  });

  it("rejects a duplicate SKU within the tenant", async () => {
    await catalog.create(actor, { sku: "DUP-1", name: "First" });
    await expect(catalog.create(actor, { sku: "DUP-1", name: "Second" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a tax rate given as a percentage instead of a fraction", async () => {
    await expect(
      catalog.create(actor, { sku: "BAD-TAX", name: "Bad tax", taxRate: "16" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("hides deactivated products from search unless asked for them", async () => {
    const product = await catalog.create(actor, { sku: "OLD-1", name: "Discontinued" });
    await catalog.create(actor, { sku: "NEW-1", name: "Current" });

    await catalog.setActive(actor, product.id, false);

    expect((await catalog.search(actor, {})).map((p) => p.sku)).toEqual(["NEW-1"]);
    expect(await catalog.search(actor, { includeInactive: true })).toHaveLength(2);
  });

  it("searches across SKU, name and description", async () => {
    await catalog.create(actor, { sku: "FIG-DRAGON-XL", name: "Figure Dragon XL", description: "Resin figure" });
    await catalog.create(actor, { sku: "BOX-A", name: "Shipping box", description: "Cardboard" });

    expect(await catalog.search(actor, { query: "dragon" })).toHaveLength(1);
    expect(await catalog.search(actor, { query: "resin" })).toHaveLength(1);
    expect(await catalog.search(actor, { query: "FIG-" })).toHaveLength(1);
    expect(await catalog.search(actor, { query: "cardboard" })).toHaveLength(1);
  });
});
