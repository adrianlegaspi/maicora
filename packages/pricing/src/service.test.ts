import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import { schema } from "@maicora/database";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@maicora/shared";
import { newId } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { PricingService, priceUpdateExecutor } from "./service.js";
import type { CostComponentInput } from "./types.js";

const dbReachable = await isTestDbReachable();

describe.skipIf(!dbReachable)("PricingService (integration)", () => {
  const db = getTestDb();
  const registry = new ExecutorRegistry();
  registry.register("PRICE_UPDATE", priceUpdateExecutor);
  const proposals = new ProposalService(db, registry);
  const pricing = new PricingService(db, proposals);

  let actor: ActorContext;
  let productId: string;

  // The spec's worked example (docs/mvp/09-proposals-and-governance.md):
  // Figure Dragon XL, true cost 181.40, sale price 230.00.
  const dragonComponents: CostComponentInput[] = [
    { type: "MATERIAL", label: "Filament", amount: "92.00" },
    { type: "MACHINE_TIME", label: "Printer time", amount: "41.40" },
    { type: "ENERGY", label: "Electricity", amount: "12.00" },
    { type: "LABOR", label: "Finishing", amount: "24.00" },
    { type: "PACKAGING", label: "Box", amount: "12.00" },
  ];

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };
    productId = newId();
    await db.insert(schema.products).values({
      id: productId,
      tenantId: tenant.tenantId,
      sku: "FIG-DRAGON-XL",
      name: "Figure Dragon XL",
      salePrice: "230.00",
      currency: "MXN",
    });
  });

  it("reproduces the spec's Figure Dragon XL pricing summary from stored cost components", async () => {
    await pricing.createCostModel(actor, {
      productId,
      pattern: "MANUFACTURED",
      targetMargin: "0.35",
      components: dragonComponents,
    });

    const summary = await pricing.getPricingSummary(actor, productId);

    expect(summary.trueEstimatedCost).toBe("181.40");
    expect(summary.breakEvenPrice).toBe("181.40");
    expect(summary.currentSalePrice).toBe("230.00");
    expect(Number(summary.currentGrossMargin)).toBeCloseTo(0.211, 3);
    expect(summary.profitPerUnitAtCurrentPrice).toBe("48.60");
    expect(summary.recommendedPriceForTargetMargin).toBe("279.08");
    expect(summary.costBreakdown).toHaveLength(5);
  });

  it("supersedes the previous cost model version instead of mutating it", async () => {
    const v1 = await pricing.createCostModel(actor, {
      productId,
      pattern: "MANUFACTURED",
      components: [{ type: "MATERIAL", label: "Filament", amount: "100.00" }],
    });
    const v2 = await pricing.createCostModel(actor, {
      productId,
      pattern: "MANUFACTURED",
      components: [{ type: "MATERIAL", label: "Filament", amount: "120.00" }],
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const all = await db.select().from(schema.costModels).where(eq(schema.costModels.productId, productId));
    expect(all).toHaveLength(2);
    expect(all.filter((m) => m.isCurrent)).toHaveLength(1);
    expect(all.find((m) => m.isCurrent)?.version).toBe(2);

    // v1's components survive untouched, so the old assumption stays inspectable.
    const v1Components = await db
      .select()
      .from(schema.costComponents)
      .where(eq(schema.costComponents.costModelId, v1.id));
    expect(v1Components[0]?.amount).toBe("100.000000");

    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(Number(product?.currentEstimatedCost)).toBe(120);
  });

  it("drafts a price update that only changes the sale price once approved and executed", async () => {
    await pricing.createCostModel(actor, {
      productId,
      pattern: "MANUFACTURED",
      targetMargin: "0.35",
      components: dragonComponents,
    });

    const proposal = await pricing.preparePriceUpdate(actor, {
      productId,
      targetMargin: "0.35",
      idempotencyKey: "price-dragon-1",
    });

    expect(proposal.kind).toBe("PRICE_UPDATE");
    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.payload.newSalePrice).toBe("279.080000");
    expect(proposal.diff.title).toBe("Product: Figure Dragon XL");

    // Still 230.00 while the proposal is only a draft.
    const [beforeExec] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(Number(beforeExec?.salePrice)).toBe(230);

    await proposals.approve(actor, proposal.id);
    const { changeset } = await proposals.execute(actor, proposal.id);

    const [afterExec] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(Number(afterExec?.salePrice)).toBe(279.08);
    expect(changeset?.entityType).toBe("product");
    expect(changeset?.reversible).toBe(true);
  });
});
