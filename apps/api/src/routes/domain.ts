import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idempotencyKey } from "@maicora/capabilities";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["PRODUCT", "SERVICE"]).optional(),
  description: z.string().nullish(),
  internalUnit: z.string().optional(),
  salePrice: z.string().optional(),
  taxRate: z.string().optional(),
  currency: z.string().optional(),
  trackInventory: z.boolean().optional(),
  satProductCode: z.string().nullish(),
  satUnitCode: z.string().nullish(),
});

const componentSchema = z.object({
  type: z.enum([
    "MATERIAL",
    "PURCHASE_COST",
    "MACHINE_TIME",
    "EQUIPMENT_ALLOCATION",
    "ENERGY",
    "LABOR",
    "PACKAGING",
    "FREIGHT",
    "DELIVERY",
    "WASTE",
    "TRANSACTION_FEE",
    "MARKETPLACE_FEE",
    "FIXED_OVERHEAD",
    "VARIABLE_OVERHEAD",
    "OTHER",
  ]),
  label: z.string().min(1),
  amount: z.string().min(1),
  notes: z.string().optional(),
});

const costModelSchema = z.object({
  productId: z.string().uuid(),
  pattern: z.enum(["RESALE", "MANUFACTURED", "SERVICE"]),
  targetMargin: z.string().optional(),
  notes: z.string().optional(),
  components: z.array(componentSchema),
});

const customerFieldsSchema = z.object({
  kind: z.enum(["BUSINESS", "INDIVIDUAL", "PUBLICO_GENERAL"]).optional(),
  displayName: z.string().min(1).optional(),
  legalName: z.string().nullish(),
  rfc: z.string().nullish(),
  taxRegime: z.string().nullish(),
  fiscalPostalCode: z.string().nullish(),
  cfdiUseDefault: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  tags: z.array(z.string()).optional(),
});

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  countedQuantity: z.string().min(1),
  reason: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
});

const invoiceDraftSchema = z.object({
  customerId: z.string().uuid().nullable(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.string().min(1), unitPrice: z.string().optional() }))
    .min(1),
  paymentForm: z.string().min(1),
  paymentMethod: z.enum(["PUE", "PPD"]),
  cfdiUse: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});

const creditNoteSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.string().min(1), unitPrice: z.string().optional() }))
    .optional(),
  paymentForm: z.string().min(1),
  reason: z.string().min(1),
});

const cancellationSchema = z.object({
  reason: z.enum(["01", "02", "03", "04"]),
  replacementUuid: z.string().optional(),
});

const fiscalSettingsSchema = z.object({
  environment: z.enum(["SANDBOX", "PRODUCTION"]),
  rfcEmisor: z.string().min(12).max(13),
  legalNameEmisor: z.string().min(1),
  regimenFiscal: z.string().min(3),
  lugarExpedicion: z.string().min(5),
  pacProvider: z.string().optional(),
  csdCertRef: z.string().nullish(),
  csdKeyRef: z.string().nullish(),
});

/**
 * The business writes the screens make. Product and warehouse edits apply
 * directly - docs/mvp/09-proposals-and-governance.md reserves approval for
 * fiscal documents, stock corrections and price changes, and putting every
 * typo behind an approval queue would only teach people to rubber-stamp.
 * The rest return a proposal.
 */
export function domainRoutes(app: FastifyInstance, container: Container): void {
  app.post("/products", async (request, reply) => {
    const actor = requireActor(request);
    const product = await container.catalog.create(actor, productSchema.parse(request.body));
    await container.audit.recordSafely(actor, actor.userId, {
      action: "product.create",
      entityType: "product",
      entityId: product.id,
    });
    return reply.status(201).send(product);
  });

  app.patch("/products/:id", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const product = await container.catalog.update(actor, id, productSchema.partial().parse(request.body));
    await container.audit.recordSafely(actor, actor.userId, {
      action: "product.update",
      entityType: "product",
      entityId: id,
    });
    return product;
  });

  app.post("/products/:id/active", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);
    return container.catalog.setActive(actor, id, isActive);
  });

  /**
   * Screens 6, 13 and 16 draft the same proposals the agent drafts, through
   * the same services - but a person clicked the button, so the proposal is
   * not marked as agent-requested. A reviewer decides partly on who asked,
   * so that flag has to say what actually happened.
   */
  app.post("/customers", async (request, reply) => {
    const actor = requireActor(request);
    const input = customerFieldsSchema.extend({ displayName: z.string().min(1) }).parse(request.body);
    const proposal = await container.customers.prepareCreate(actor, input, {
      idempotencyKey: idempotencyKey("customers.create", input),
    });
    return reply.status(201).send(proposal);
  });

  app.patch("/customers/:id", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const patch = customerFieldsSchema.parse(request.body);
    return container.customers.prepareUpdate(actor, id, patch, {
      idempotencyKey: idempotencyKey("customers.update", { id, patch }),
    });
  });

  app.post("/inventory/adjustments", async (request, reply) => {
    const actor = requireActor(request);
    const input = adjustmentSchema.parse(request.body);
    const proposal = await container.inventory.prepareAdjustment(actor, {
      ...input,
      idempotencyKey: idempotencyKey("inventory.adjustment", input),
    });
    return reply.status(201).send(proposal);
  });

  app.post("/invoices/drafts", async (request, reply) => {
    const actor = requireActor(request);
    const input = invoiceDraftSchema.parse(request.body);
    const proposal = await container.invoices.prepareInvoice(actor, {
      ...input,
      idempotencyKey: idempotencyKey("invoices.draft", input),
    });
    return reply.status(201).send(proposal);
  });

  app.post("/invoices/:id/credit-notes", async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const input = { invoiceId: id, ...creditNoteSchema.parse(request.body) };
    const proposal = await container.invoices.prepareCreditNote(actor, {
      ...input,
      idempotencyKey: idempotencyKey("invoices.credit_note", input),
    });
    return reply.status(201).send(proposal);
  });

  app.post("/invoices/:id/cancellations", async (request, reply) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const input = { invoiceId: id, ...cancellationSchema.parse(request.body) };
    const proposal = await container.invoices.prepareCancellation(actor, {
      ...input,
      idempotencyKey: idempotencyKey("invoices.cancellation", input),
    });
    return reply.status(201).send(proposal);
  });

  app.post("/pricing/price-updates", async (request, reply) => {
    const actor = requireActor(request);
    const input = z
      .object({
        productId: z.string().uuid(),
        targetMargin: z.number().positive().lt(1).optional(),
        newSalePrice: z.string().optional(),
      })
      .parse(request.body);
    const proposal = await container.pricing.preparePriceUpdate(actor, {
      ...input,
      idempotencyKey: idempotencyKey("pricing.price_update", input),
    });
    return reply.status(201).send(proposal);
  });

  app.post("/customers/:id/archive", async (request) => {
    const actor = requireActor(request);
    const { id } = request.params as { id: string };
    const { isArchived } = z.object({ isArchived: z.boolean().default(true) }).parse(request.body ?? {});
    await container.customers.archive(actor, id, isArchived);
    return { ok: true };
  });

  app.get("/warehouses", async (request) => container.inventory.listWarehouses(requireActor(request)));

  app.post("/warehouses", async (request, reply) => {
    const actor = requireActor(request);
    const input = z
      .object({
        name: z.string().min(1),
        code: z.string().min(1),
        branchId: z.string().uuid().nullish(),
        isDefault: z.boolean().optional(),
      })
      .parse(request.body);
    return reply.status(201).send(await container.inventory.createWarehouse(actor, input));
  });

  app.post("/cost-models", async (request, reply) => {
    const actor = requireActor(request);
    const model = await container.pricing.createCostModel(actor, costModelSchema.parse(request.body));
    await container.audit.recordSafely(actor, actor.userId, {
      action: "cost_model.create",
      entityType: "product",
      entityId: model.productId,
      metadata: { version: model.version },
    });
    return reply.status(201).send(model);
  });

  app.get("/fiscal-settings", async (request) => {
    const actor = requireActor(request);
    const { environment } = request.query as { environment?: "SANDBOX" | "PRODUCTION" };
    return container.fiscalSettings.get(actor, environment ?? container.config.fiscalEnvironment);
  });

  app.put("/fiscal-settings", async (request) => {
    const actor = requireActor(request);
    const settings = await container.fiscalSettings.save(actor, fiscalSettingsSchema.parse(request.body));
    await container.audit.recordSafely(actor, actor.userId, {
      action: "fiscal_settings.save",
      entityType: "fiscal_settings",
      entityId: settings.id,
      metadata: { environment: settings.environment },
    });
    return settings;
  });
}
