import { Decimal } from "decimal.js";
import type { ActorContext } from "@maicora/shared";
import { Money, NotFoundError, ValidationError } from "@maicora/shared";
import type { Database } from "@maicora/database";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { BusinessDiff, Executor, ProposalRecord, ProposalService, Reverter } from "@maicora/proposals";
import { PricingRepository } from "./repository.js";
import {
  calculateBreakEvenPrice,
  calculateGrossMargin,
  calculateMarkup,
  calculateProfitPerUnit,
  calculateTargetPrice,
  calculateTrueCost,
  compareScenarios as compareScenariosMath,
} from "./calculator.js";
import type { CostModelInput, CostModelRecord, PricingSummary, ScenarioInput, ScenarioResult } from "./types.js";

/** "0.2113" -> "21.1%", "0.35" -> "35%", matching the spec's diff examples. */
function formatPercent(fraction: Decimal.Value): string {
  return `${new Decimal(fraction).times(100).toDecimalPlaces(1).toString()}%`;
}

export interface PreparePriceUpdateInput {
  productId: string;
  /** Explicit new price, or omit and pass `targetMargin` to derive one. */
  newSalePrice?: Decimal.Value;
  targetMargin?: Decimal.Value;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export class PricingService {
  constructor(
    private readonly db: Database,
    private readonly proposals: ProposalService,
  ) {}

  /**
   * The one deterministic pricing read (docs/mvp/06-pricing-and-costing.md
   * "Pricing Outputs"). Non-negotiable #11: the agent calls this and narrates
   * the result; it never computes a price itself.
   */
  async getPricingSummary(
    actor: ActorContext,
    productId: string,
    options?: { targetMargin?: Decimal.Value },
  ): Promise<PricingSummary> {
    assertPermission(actor, PERMISSIONS.PRICING_READ);
    const repo = new PricingRepository(this.db);

    const product = await repo.getProduct(actor, productId);
    if (!product) throw new NotFoundError("Product", productId);
    const costModel = await repo.getCurrentCostModel(actor, productId);
    if (!costModel) throw new NotFoundError("Cost model for product", productId);

    const currency = product.currency;
    const trueCost = calculateTrueCost(costModel.components, currency);
    const salePrice = Money.of(product.salePrice, currency).round();
    const priced = !salePrice.isZero();

    const targetMarginRaw = options?.targetMargin ?? costModel.targetMargin;
    const targetMargin = targetMarginRaw == null ? null : new Decimal(targetMarginRaw);

    return {
      productId,
      costModelId: costModel.id,
      costModelVersion: costModel.version,
      currency,
      trueEstimatedCost: trueCost.toFixed(2),
      breakEvenPrice: calculateBreakEvenPrice(trueCost).toFixed(2),
      currentSalePrice: priced ? salePrice.toFixed(2) : null,
      currentMarkup: priced && !trueCost.isZero() ? calculateMarkup(trueCost, salePrice).toFixed(4) : null,
      currentGrossMargin: priced ? calculateGrossMargin(trueCost, salePrice).toFixed(4) : null,
      profitPerUnitAtCurrentPrice: priced ? calculateProfitPerUnit(trueCost, salePrice).toFixed(2) : null,
      targetMargin: targetMargin ? targetMargin.toFixed(4) : null,
      recommendedPriceForTargetMargin: targetMargin ? calculateTargetPrice(trueCost, targetMargin).toFixed(2) : null,
      costBreakdown: costModel.components.map((c) => ({
        type: c.type,
        label: c.label,
        amount: Money.of(c.amount, currency).toFixed(2),
      })),
    };
  }

  async compareScenarios(actor: ActorContext, productId: string, scenarios: ScenarioInput[]): Promise<ScenarioResult[]> {
    assertPermission(actor, PERMISSIONS.PRICING_READ);
    const repo = new PricingRepository(this.db);

    const product = await repo.getProduct(actor, productId);
    if (!product) throw new NotFoundError("Product", productId);
    const costModel = await repo.getCurrentCostModel(actor, productId);
    if (!costModel) throw new NotFoundError("Cost model for product", productId);

    return compareScenariosMath(calculateTrueCost(costModel.components, product.currency), scenarios);
  }

  /**
   * Records a new cost model version. Changing a cost assumption is not a
   * critical write (it moves no money, stock or fiscal state), so it applies
   * directly; only the resulting sale price change needs approval.
   */
  async createCostModel(actor: ActorContext, input: CostModelInput): Promise<CostModelRecord> {
    assertPermission(actor, PERMISSIONS.PRICING_WRITE);
    if (input.components.length === 0) {
      throw new ValidationError("A cost model needs at least one cost component", { productId: input.productId });
    }
    const product = await new PricingRepository(this.db).getProduct(actor, input.productId);
    if (!product) throw new NotFoundError("Product", input.productId);

    const trueCost = calculateTrueCost(input.components, product.currency);
    return this.db.transaction(async (tx) => {
      const repo = new PricingRepository(tx);
      const model = await repo.createVersion(actor, input, actor.userId);
      await repo.updateEstimatedCost(actor, input.productId, trueCost.toStorage());
      return model;
    });
  }

  /**
   * Drafts the pricing Business Diff from docs/mvp/09-proposals-and-governance.md
   * as a PRICE_UPDATE proposal. Applying it needs approval ("Change product
   * sale price through agent"); the proposal's risk level enforces that.
   */
  async preparePriceUpdate(actor: ActorContext, input: PreparePriceUpdateInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.PRICING_WRITE);
    if (input.newSalePrice === undefined && input.targetMargin === undefined) {
      throw new ValidationError("Either newSalePrice or targetMargin is required", { productId: input.productId });
    }

    const product = await new PricingRepository(this.db).getProduct(actor, input.productId);
    if (!product) throw new NotFoundError("Product", input.productId);

    const summary = await this.getPricingSummary(actor, input.productId, { targetMargin: input.targetMargin });
    const trueCost = Money.of(summary.trueEstimatedCost, summary.currency);
    const newPrice =
      input.newSalePrice !== undefined
        ? Money.of(input.newSalePrice, summary.currency).round()
        : calculateTargetPrice(trueCost, input.targetMargin as Decimal.Value);

    return this.proposals.create(actor, {
      kind: "PRICE_UPDATE",
      payload: {
        productId: input.productId,
        newSalePrice: newPrice.toStorage(),
        costModelId: summary.costModelId,
        costModelVersion: summary.costModelVersion,
      },
      diff: priceUpdateDiff(product.name, summary, newPrice),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

/** Mirrors the pricing proposal example in docs/mvp/09-proposals-and-governance.md. */
function priceUpdateDiff(productName: string, summary: PricingSummary, newPrice: Money): BusinessDiff {
  const { currency } = summary;
  const trueCost = Money.of(summary.trueEstimatedCost, currency);

  const current = [`Current estimated cost: ${currency} ${summary.trueEstimatedCost}`];
  if (summary.currentSalePrice && summary.currentGrossMargin) {
    current.push(`Current sale price:      ${currency} ${summary.currentSalePrice}`);
    current.push(`Current margin:          ${formatPercent(summary.currentGrossMargin)}`);
  } else {
    current.push("Current sale price:      not set");
  }

  const proposed: string[] = [];
  if (summary.targetMargin) proposed.push(`Target margin:           ${formatPercent(summary.targetMargin)}`);
  proposed.push(`Recommended price:       ${currency} ${newPrice.toFixed(2)}`);
  proposed.push(`New margin:              ${formatPercent(calculateGrossMargin(trueCost, newPrice))}`);

  return {
    title: `Product: ${productName}`,
    sections: [
      { lines: current },
      { lines: proposed },
      {
        changes: [
          {
            label: "Sale price",
            before: summary.currentSalePrice ? `${currency} ${summary.currentSalePrice}` : "not set",
            after: `${currency} ${newPrice.toFixed(2)}`,
          },
        ],
      },
    ],
  };
}

/**
 * Applies an approved PRICE_UPDATE. Runs inside the ProposalService's
 * transaction so the product write and its ChangeSet commit together.
 * Register with `registry.register("PRICE_UPDATE", priceUpdateExecutor)`.
 */
export const priceUpdateExecutor: Executor = async ({ tx, actor, payload }) => {
  const productId = String(payload.productId);
  const newSalePrice = String(payload.newSalePrice);

  const repo = new PricingRepository(tx);
  const product = await repo.getProduct(actor, productId);
  if (!product) throw new NotFoundError("Product", productId);

  await repo.updateSalePrice(actor, productId, newSalePrice);

  return {
    entityType: "product",
    entityId: productId,
    action: "UPDATE",
    before: { salePrice: product.salePrice },
    after: { salePrice: newSalePrice },
    // docs/mvp/09-proposals-and-governance.md lists price changes as reversible.
    reversible: true,
    result: { productId, salePrice: newSalePrice },
  };
};

/** Puts a reverted price change back to the price the ChangeSet recorded. */
export const priceUpdateReverter: Reverter = async ({ tx, actor, changeset }) => {
  const previous = (changeset.before as { salePrice?: string } | null)?.salePrice;
  if (!previous) throw new ValidationError("That price change did not record the price it replaced", {});

  const repo = new PricingRepository(tx);
  const product = await repo.getProduct(actor, changeset.entityId);
  if (!product) throw new NotFoundError("Product", changeset.entityId);
  await repo.updateSalePrice(actor, changeset.entityId, previous);

  return {
    entityType: "product",
    entityId: changeset.entityId,
    action: "REVERT",
    before: { salePrice: product.salePrice },
    after: { salePrice: previous },
    reversible: false,
    result: { productId: changeset.entityId, salePrice: previous },
  };
};
