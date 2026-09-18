import { createHash } from "node:crypto";
import { z } from "zod";
import { PERMISSIONS } from "@maicora/tenancy";
import type { CustomerService } from "@maicora/customers";
import type { CatalogService } from "@maicora/catalog";
import type { InventoryService } from "@maicora/inventory";
import type { PricingService } from "@maicora/pricing";
import type { InvoiceService } from "@maicora/invoices";
import type { Capability } from "./types.js";

export interface CapabilityServices {
  customers: CustomerService;
  catalog: CatalogService;
  inventory: InventoryService;
  pricing: PricingService;
  invoices: InvoiceService;
}

/**
 * Proposal idempotency keys are derived from the request rather than asked
 * for, because the caller most likely to retry is a language model and it
 * will not reliably reuse a key it invented. Identical arguments produce the
 * identical key, so a repeated tool call returns the existing proposal
 * instead of drafting a second one.
 */
export function idempotencyKey(name: string, input: unknown): string {
  return createHash("sha256").update(`${name}:${stableStringify(input)}`).digest("hex").slice(0, 32);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Must be a decimal number written as a string");

const itemSchema = z.object({
  productId: z.string().uuid().optional(),
  description: z.string().optional(),
  quantity: decimalString,
  unitPrice: decimalString.optional(),
  discount: decimalString.optional(),
  taxRate: decimalString.optional(),
});

const customerFields = {
  displayName: z.string().min(1).optional(),
  kind: z.enum(["BUSINESS", "INDIVIDUAL", "PUBLICO_GENERAL"]).optional(),
  legalName: z.string().nullish(),
  rfc: z.string().nullish(),
  taxRegime: z.string().nullish(),
  fiscalPostalCode: z.string().nullish(),
  cfdiUseDefault: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  tags: z.array(z.string()).optional(),
};

/**
 * The MVP capability set, exactly as docs/mvp/08-agent.md lists it - kept
 * "deliberately small and excellent" rather than one tool per endpoint. The
 * `mcp` flag marks the narrower set docs/mvp/10-mcp.md exposes externally.
 */
export function buildCapabilities(services: CapabilityServices): Capability<never, unknown>[] {
  const { customers, catalog, inventory, pricing, invoices } = services;

  const definitions: Capability<never, unknown>[] = [];
  const define = <I, O>(capability: Capability<I, O>) => {
    definitions.push(capability as unknown as Capability<never, unknown>);
  };

  // --- Read / analyze -----------------------------------------------------

  define({
    name: "customers.search",
    description:
      "Find customers by name, legal name, RFC or email. Use this before anything that needs a customer id.",
    permission: PERMISSIONS.CUSTOMERS_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      query: z.string().optional(),
      kind: z.enum(["BUSINESS", "INDIVIDUAL", "PUBLICO_GENERAL"]).optional(),
      tag: z.string().optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    handler: (actor, input) => customers.search(actor, input),
  });

  define({
    name: "customers.get",
    description: "Read one customer, including their fiscal profile.",
    permission: PERMISSIONS.CUSTOMERS_READ,
    readOnly: true,
    mcp: true,
    input: z.object({ customerId: z.string().uuid() }),
    handler: (actor, input) => customers.get(actor, input.customerId),
  });

  define({
    name: "customers.get_invoice_history",
    description: "List a customer's invoices, most recent first.",
    permission: PERMISSIONS.CUSTOMERS_READ,
    readOnly: true,
    mcp: false,
    input: z.object({
      customerId: z.string().uuid(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    handler: (actor, input) => customers.getInvoiceHistory(actor, input.customerId, input.limit),
  });

  define({
    name: "customers.find_missing_fiscal_data",
    description:
      "List customers that cannot be invoiced yet and exactly which fiscal fields each one is missing.",
    permission: PERMISSIONS.CUSTOMERS_READ,
    readOnly: true,
    mcp: false,
    input: z.object({ limit: z.number().int().positive().max(500).optional() }),
    handler: (actor, input) => customers.findCustomersMissingFiscalData(actor, input.limit),
  });

  define({
    name: "products.search",
    description: "Find products and services by SKU, name or description.",
    permission: PERMISSIONS.PRODUCTS_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      query: z.string().optional(),
      kind: z.enum(["PRODUCT", "SERVICE"]).optional(),
      includeInactive: z.boolean().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    handler: (actor, input) => catalog.search(actor, input),
  });

  define({
    name: "products.get",
    description: "Read one product, including its price, tax rate and SAT codes.",
    permission: PERMISSIONS.PRODUCTS_READ,
    readOnly: true,
    mcp: true,
    input: z.object({ productId: z.string().uuid() }),
    handler: (actor, input) => catalog.get(actor, input.productId),
  });

  define({
    name: "inventory.get_stock",
    description: "Current quantity on hand per product and warehouse.",
    permission: PERMISSIONS.INVENTORY_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      productId: z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
    }),
    handler: (actor, input) => inventory.getStock(actor, input),
  });

  define({
    name: "inventory.get_movements",
    description: "The stock ledger: every movement that produced the current balance.",
    permission: PERMISSIONS.INVENTORY_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      productId: z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }),
    handler: (actor, input) => inventory.getMovements(actor, input),
  });

  define({
    name: "inventory.find_low_stock",
    description: "Products at or below a quantity threshold, lowest first.",
    permission: PERMISSIONS.INVENTORY_READ,
    readOnly: true,
    mcp: false,
    input: z.object({
      threshold: decimalString.optional(),
      warehouseId: z.string().uuid().optional(),
    }),
    handler: (actor, input) => inventory.findLowStock(actor, input.threshold, input.warehouseId),
  });

  define({
    name: "pricing.calculate_true_cost",
    description:
      "Deterministic cost and margin breakdown for a product. Always call this instead of doing pricing arithmetic yourself.",
    permission: PERMISSIONS.PRICING_READ,
    readOnly: true,
    mcp: true,
    input: z.object({ productId: z.string().uuid() }),
    handler: (actor, input) => pricing.getPricingSummary(actor, input.productId),
  });

  define({
    name: "pricing.calculate_target_price",
    description:
      "The sale price that achieves a target gross margin, expressed as a fraction such as 0.35 for 35%.",
    permission: PERMISSIONS.PRICING_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      productId: z.string().uuid(),
      targetMargin: z.number().gt(0).lt(1),
    }),
    handler: (actor, input) =>
      pricing.getPricingSummary(actor, input.productId, { targetMargin: input.targetMargin }),
  });

  define({
    name: "pricing.compare_scenarios",
    description: "Margin, markup and profit per unit at several candidate sale prices.",
    permission: PERMISSIONS.PRICING_READ,
    readOnly: true,
    mcp: false,
    input: z.object({
      productId: z.string().uuid(),
      scenarios: z
        .array(z.object({ label: z.string(), salePrice: decimalString }))
        .min(1)
        .max(10),
    }),
    handler: (actor, input) => pricing.compareScenarios(actor, input.productId, input.scenarios),
  });

  define({
    name: "invoices.search",
    description: "Find invoices by customer, status or kind.",
    permission: PERMISSIONS.INVOICES_READ,
    readOnly: true,
    mcp: true,
    input: z.object({
      customerId: z.string().uuid().optional(),
      status: z
        .enum([
          "DRAFT",
          "PENDING_APPROVAL",
          "APPROVED",
          "STAMPED",
          "CANCELLATION_REQUESTED",
          "CANCELLED",
          "ERROR",
        ])
        .optional(),
      kind: z.enum(["INGRESO", "EGRESO", "GLOBAL"]).optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    handler: (actor, input) => invoices.search(actor, input),
  });

  define({
    name: "invoices.get",
    description: "Read one invoice with its lines and fiscal status.",
    permission: PERMISSIONS.INVOICES_READ,
    readOnly: true,
    mcp: true,
    input: z.object({ invoiceId: z.string().uuid() }),
    handler: (actor, input) => invoices.get(actor, input.invoiceId),
  });

  define({
    name: "invoices.explain",
    description: "A plain-language summary of one invoice: its lines, subtotal, tax and total.",
    permission: PERMISSIONS.INVOICES_READ,
    readOnly: true,
    mcp: false,
    input: z.object({ invoiceId: z.string().uuid() }),
    handler: (actor, input) => invoices.explain(actor, input.invoiceId),
  });

  // --- Draft / proposal ---------------------------------------------------
  // None of these change anything. Each returns a proposal with a Business
  // Diff; a human approves it, and only then does an executor run.

  define({
    name: "customers.prepare_create",
    description:
      "Draft a new customer. Returns a proposal with a diff; the customer does not exist until it is executed.",
    permission: PERMISSIONS.CUSTOMERS_WRITE,
    readOnly: false,
    mcp: false,
    input: z.object({ ...customerFields, displayName: z.string().min(1) }),
    handler: (actor, input) =>
      customers.prepareCreate(actor, input, {
        idempotencyKey: idempotencyKey("customers.prepare_create", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "customers.prepare_update",
    description: "Draft a change to an existing customer. Pass only the fields that change.",
    permission: PERMISSIONS.CUSTOMERS_WRITE,
    readOnly: false,
    mcp: false,
    input: z.object({ customerId: z.string().uuid(), patch: z.object(customerFields) }),
    handler: (actor, input) =>
      customers.prepareUpdate(actor, input.customerId, input.patch, {
        idempotencyKey: idempotencyKey("customers.prepare_update", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "inventory.prepare_adjustment",
    description:
      "Draft a stock correction to a counted quantity. A reason is required and the change needs approval.",
    permission: PERMISSIONS.INVENTORY_ADJUST_PROPOSE,
    readOnly: false,
    mcp: false,
    input: z.object({
      productId: z.string().uuid(),
      countedQuantity: decimalString,
      reason: z.string().min(1),
      warehouseId: z.string().uuid().optional(),
    }),
    handler: (actor, input) =>
      inventory.prepareAdjustment(actor, {
        ...input,
        idempotencyKey: idempotencyKey("inventory.prepare_adjustment", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "pricing.prepare_price_update",
    description:
      "Draft a sale price change, either to an explicit price or to whatever achieves a target margin.",
    permission: PERMISSIONS.PRICING_WRITE,
    readOnly: false,
    mcp: false,
    input: z
      .object({
        productId: z.string().uuid(),
        newSalePrice: decimalString.optional(),
        targetMargin: z.number().gt(0).lt(1).optional(),
      })
      .refine((value) => Boolean(value.newSalePrice) !== Boolean(value.targetMargin), {
        message: "Give either newSalePrice or targetMargin, not both",
      }),
    handler: (actor, input) =>
      pricing.preparePriceUpdate(actor, {
        ...input,
        idempotencyKey: idempotencyKey("pricing.prepare_price_update", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "invoices.prepare_invoice",
    description:
      "Draft a CFDI ingreso. Shows the tax calculation and the stock impact; stamping happens only after approval.",
    permission: PERMISSIONS.INVOICES_DRAFT,
    readOnly: false,
    mcp: true,
    input: z.object({
      customerId: z.string().uuid().nullable(),
      items: z.array(itemSchema).min(1),
      paymentForm: z.string().min(1),
      paymentMethod: z.enum(["PUE", "PPD"]),
      cfdiUse: z.string().optional(),
      currency: z.string().optional(),
      warehouseId: z.string().uuid().optional(),
    }),
    handler: (actor, input) =>
      invoices.prepareInvoice(actor, {
        ...input,
        idempotencyKey: idempotencyKey("invoices.prepare_invoice", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "invoices.prepare_global_invoice",
    description: "Draft a factura global covering a period's publico-en-general sales.",
    permission: PERMISSIONS.INVOICES_DRAFT,
    readOnly: false,
    mcp: false,
    input: z.object({
      items: z.array(itemSchema).min(1),
      paymentForm: z.string().min(1),
      periodicity: z.enum(["01", "02", "03", "04", "05"]),
      months: z.string().min(2),
      year: z.number().int().min(2020).max(2100),
      warehouseId: z.string().uuid().optional(),
    }),
    handler: (actor, input) =>
      invoices.prepareGlobalInvoice(actor, {
        ...input,
        idempotencyKey: idempotencyKey("invoices.prepare_global_invoice", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "invoices.prepare_credit_note",
    description: "Draft a CFDI egreso correcting a stamped invoice. Defaults to crediting every line.",
    permission: PERMISSIONS.INVOICES_DRAFT,
    readOnly: false,
    mcp: false,
    input: z.object({
      invoiceId: z.string().uuid(),
      items: z.array(itemSchema).optional(),
      paymentForm: z.string().min(1),
      reason: z.string().min(1),
    }),
    handler: (actor, input) =>
      invoices.prepareCreditNote(actor, {
        ...input,
        idempotencyKey: idempotencyKey("invoices.prepare_credit_note", input),
        requestedByAgent: true,
      }),
  });

  define({
    name: "invoices.prepare_cancellation",
    description:
      "Draft the cancellation of a stamped CFDI. Reason 01 also needs the UUID of the replacement document.",
    permission: PERMISSIONS.INVOICES_DRAFT,
    readOnly: false,
    mcp: false,
    input: z.object({
      invoiceId: z.string().uuid(),
      reason: z.enum(["01", "02", "03", "04"]),
      replacementUuid: z.string().optional(),
    }),
    handler: (actor, input) =>
      invoices.prepareCancellation(actor, {
        ...input,
        idempotencyKey: idempotencyKey("invoices.prepare_cancellation", input),
        requestedByAgent: true,
      }),
  });

  return definitions;
}
