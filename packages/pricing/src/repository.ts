import { eq, and } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { CostComponentType, CostModelInput, CostModelRecord, CostPattern } from "./types.js";

function toRecord(
  model: typeof schema.costModels.$inferSelect,
  components: (typeof schema.costComponents.$inferSelect)[],
): CostModelRecord {
  return {
    id: model.id,
    productId: model.productId,
    version: model.version,
    pattern: model.pattern as CostPattern,
    isCurrent: model.isCurrent,
    targetMargin: model.targetMargin,
    notes: model.notes,
    createdAt: model.createdAt,
    components: components.map((c) => ({
      id: c.id,
      type: c.type as CostComponentType,
      label: c.label,
      amount: c.amount,
      notes: c.notes,
    })),
  };
}

export class PricingRepository {
  constructor(private readonly db: DbClient) {}

  async getProduct(scope: TenantScope, productId: string) {
    const [row] = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        salePrice: schema.products.salePrice,
        currency: schema.products.currency,
        currentEstimatedCost: schema.products.currentEstimatedCost,
      })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.id, productId)))
      .limit(1);
    return row ?? null;
  }

  async getCurrentCostModel(scope: TenantScope, productId: string): Promise<CostModelRecord | null> {
    const [model] = await this.db
      .select()
      .from(schema.costModels)
      .where(
        and(
          eq(schema.costModels.tenantId, scope.tenantId),
          eq(schema.costModels.productId, productId),
          eq(schema.costModels.isCurrent, true),
        ),
      )
      .limit(1);
    if (!model) return null;
    return toRecord(model, await this.listComponents(scope, model.id));
  }

  private async listComponents(scope: TenantScope, costModelId: string) {
    return this.db
      .select()
      .from(schema.costComponents)
      .where(
        and(
          eq(schema.costComponents.tenantId, scope.tenantId),
          eq(schema.costComponents.costModelId, costModelId),
        ),
      );
  }

  /**
   * Inserts a new cost model version and flips `isCurrent` off the previous
   * one atomically. docs/mvp/06-pricing-and-costing.md "Versioning" requires
   * historical cost assumptions to stay inspectable, so an existing version
   * is never mutated or deleted, only superseded.
   */
  async createVersion(scope: TenantScope, input: CostModelInput, createdBy: string): Promise<CostModelRecord> {
    return this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ version: schema.costModels.version })
        .from(schema.costModels)
        .where(
          and(
            eq(schema.costModels.tenantId, scope.tenantId),
            eq(schema.costModels.productId, input.productId),
            eq(schema.costModels.isCurrent, true),
          ),
        )
        .limit(1);

      if (previous) {
        await tx
          .update(schema.costModels)
          .set({ isCurrent: false })
          .where(
            and(
              eq(schema.costModels.tenantId, scope.tenantId),
              eq(schema.costModels.productId, input.productId),
              eq(schema.costModels.isCurrent, true),
            ),
          );
      }

      const [model] = await tx
        .insert(schema.costModels)
        .values({
          id: newId(),
          tenantId: scope.tenantId,
          productId: input.productId,
          version: (previous?.version ?? 0) + 1,
          pattern: input.pattern,
          isCurrent: true,
          targetMargin: input.targetMargin === undefined ? null : String(input.targetMargin),
          notes: input.notes ?? null,
          createdBy,
        })
        .returning();
      if (!model) throw new Error("Failed to insert cost model");

      const components = input.components.length
        ? await tx
            .insert(schema.costComponents)
            .values(
              input.components.map((c) => ({
                id: newId(),
                tenantId: scope.tenantId,
                costModelId: model.id,
                type: c.type,
                label: c.label,
                amount: String(c.amount),
                notes: c.notes ?? null,
              })),
            )
            .returning()
        : [];

      return toRecord(model, components);
    });
  }

  /**
   * Denormalises the newest cost model's true cost onto the product so list
   * screens and invoice drafts can show margin without recomputing every
   * cost model. Always written in the same transaction as the cost model
   * version that produced it.
   */
  async updateEstimatedCost(scope: TenantScope, productId: string, estimatedCost: string): Promise<void> {
    await this.db
      .update(schema.products)
      .set({ currentEstimatedCost: estimatedCost, updatedAt: new Date() })
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.id, productId)));
  }

  /** Called only by the PRICE_UPDATE executor, inside the proposal's transaction. */
  async updateSalePrice(scope: TenantScope, productId: string, newSalePrice: string): Promise<void> {
    await this.db
      .update(schema.products)
      .set({ salePrice: newSalePrice, updatedAt: new Date() })
      .where(and(eq(schema.products.tenantId, scope.tenantId), eq(schema.products.id, productId)));
  }
}
