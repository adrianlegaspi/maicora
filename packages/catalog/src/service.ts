import type { ActorContext } from "@maicora/shared";
import { ConflictError, Money, NotFoundError, ValidationError } from "@maicora/shared";
import type { Database } from "@maicora/database";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import { CatalogRepository, type ProductRow } from "./repository.js";
import type { ProductInput, ProductPatch, ProductSearchParams } from "./types.js";

function assertPrice(salePrice: string | undefined, currency: string | undefined): void {
  if (salePrice === undefined) return;
  if (Money.of(salePrice, currency ?? "MXN").isNegative()) {
    throw new ValidationError("Sale price cannot be negative", { salePrice });
  }
}

function assertTaxRate(taxRate: string | undefined): void {
  if (taxRate === undefined) return;
  const rate = Number(taxRate);
  // A tax rate is a fraction (0.16), not a percentage (16).
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new ValidationError("Tax rate must be a fraction between 0 and 1", { taxRate });
  }
}

/**
 * Products and services (docs/mvp/04-core-domains.md). Writes here apply
 * directly rather than through a proposal: no product proposal kind exists,
 * and the agent is only granted `products.search` / `products.get`, so the
 * one agent-reachable path to a price change stays PRICE_UPDATE in
 * packages/pricing, which does require approval.
 */
export class CatalogService {
  constructor(private readonly db: Database) {}

  async search(actor: ActorContext, params: ProductSearchParams = {}): Promise<ProductRow[]> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_READ);
    return new CatalogRepository(this.db).search(actor, params);
  }

  async get(actor: ActorContext, productId: string): Promise<ProductRow> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_READ);
    const product = await new CatalogRepository(this.db).get(actor, productId);
    if (!product) throw new NotFoundError("Product", productId);
    return product;
  }

  async getBySku(actor: ActorContext, sku: string): Promise<ProductRow> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_READ);
    const product = await new CatalogRepository(this.db).getBySku(actor, sku);
    if (!product) throw new NotFoundError("Product with SKU", sku);
    return product;
  }

  async create(actor: ActorContext, input: ProductInput): Promise<ProductRow> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_WRITE);
    if (!input.sku?.trim()) throw new ValidationError("A product needs a SKU", { field: "sku" });
    if (!input.name?.trim()) throw new ValidationError("A product needs a name", { field: "name" });
    assertPrice(input.salePrice, input.currency);
    assertTaxRate(input.taxRate);

    const repo = new CatalogRepository(this.db);
    const sku = input.sku.trim();
    if (await repo.getBySku(actor, sku)) {
      throw new ConflictError(`A product with SKU ${sku} already exists`, { sku });
    }

    return repo.insert(actor, {
      ...input,
      sku,
      name: input.name.trim(),
      // A service has nothing to count, so it opts out of the stock ledger
      // unless the caller insists otherwise.
      trackInventory: input.trackInventory ?? input.kind !== "SERVICE",
    });
  }

  async update(actor: ActorContext, productId: string, patch: ProductPatch): Promise<ProductRow> {
    assertPermission(actor, PERMISSIONS.PRODUCTS_WRITE);
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("A product update needs at least one field", { productId });
    }
    assertPrice(patch.salePrice, patch.currency);
    assertTaxRate(patch.taxRate);

    const updated = await new CatalogRepository(this.db).update(actor, productId, patch);
    if (!updated) throw new NotFoundError("Product", productId);
    return updated;
  }

  /** Deactivating keeps the product on historical invoices; nothing is deleted. */
  async setActive(actor: ActorContext, productId: string, isActive: boolean): Promise<ProductRow> {
    return this.update(actor, productId, { isActive });
  }
}
