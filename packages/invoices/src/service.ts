import { Decimal } from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import type { ActorContext } from "@maicora/shared";
import { ConflictError, NotFoundError, ValidationError } from "@maicora/shared";
import { schema, type Database, type DbClient } from "@maicora/database";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { BusinessDiff, ProposalRecord, ProposalService } from "@maicora/proposals";
import { checkFiscalReadiness, RFC_PUBLICO_GENERAL } from "@maicora/customers";
import { InventoryRepository } from "@maicora/inventory";
import type { FiscalEnvironment } from "@maicora/cfdi";
import { InvoiceRepository, type InvoiceRow, type InvoiceWithItems } from "./repository.js";
import { calculateLine, calculateTotals } from "./calculator.js";
import type {
  InvoiceItemInput,
  InvoiceSearchParams,
  InvoiceTotals,
  PrepareCancellationInput,
  PrepareCreditNoteInput,
  PrepareGlobalInvoiceInput,
  PrepareInvoiceInput,
  ResolvedLine,
  StockImpact,
} from "./types.js";

/** Trims the trailing zeros Postgres numerics carry, so diffs read "10" not "10.000000". */
function qty(value: string): string {
  return new Decimal(value).toString();
}

function money(value: string, currency: string): string {
  return `${currency} ${new Decimal(value).toDecimalPlaces(2).toNumber().toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * SAT fallbacks for a free-text line: "01010101" is the catalog's own
 * "no existe en el catalogo" product key and "ACT" its generic unit.
 */
const FREE_TEXT_PRODUCT_CODE = "01010101";
const FREE_TEXT_UNIT_CODE = "ACT";

/** The receptor of a publico-en-general receipt, per the SAT's CFDI 4.0 rules. */
export const PUBLICO_GENERAL_RECIPIENT = {
  rfc: RFC_PUBLICO_GENERAL,
  name: "PUBLICO EN GENERAL",
  regimenFiscal: "616",
  cfdiUse: "S01",
} as const;

export interface InvoiceServiceOptions {
  /**
   * Which fiscal settings row and PAC environment invoices are issued
   * against. Sandbox until a tenant has production CSDs loaded.
   */
  environment?: FiscalEnvironment;
  /**
   * docs/mvp/07-invoicing-cfdi.md: "Negative stock follows deterministic
   * tenant policy". The MVP schema has no tenant settings table, so the
   * policy is a deployment option here and defaults to refusing the invoice.
   * ponytail: move to a tenant_settings row when tenants need to differ.
   */
  negativeStock?: "BLOCK" | "ALLOW";
}

export class InvoiceService {
  private readonly environment: FiscalEnvironment;

  constructor(
    private readonly db: Database,
    private readonly proposals: ProposalService,
    private readonly options: InvoiceServiceOptions = {},
  ) {
    this.environment = options.environment ?? "SANDBOX";
  }

  async search(actor: ActorContext, params: InvoiceSearchParams = {}): Promise<InvoiceRow[]> {
    assertPermission(actor, PERMISSIONS.INVOICES_READ);
    return new InvoiceRepository(this.db).search(actor, params);
  }

  async get(actor: ActorContext, invoiceId: string): Promise<InvoiceWithItems> {
    assertPermission(actor, PERMISSIONS.INVOICES_READ);
    const invoice = await new InvoiceRepository(this.db).get(actor, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice", invoiceId);
    return invoice;
  }

  /**
   * Drafts a CFDI 4.0 ingreso (docs/mvp/07-invoicing-cfdi.md). Nothing is
   * written and nothing is stamped here: the proposal carries the priced
   * lines an approver saw, and execution is what touches stock and the PAC.
   */
  async prepareInvoice(actor: ActorContext, input: PrepareInvoiceInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.INVOICES_DRAFT);
    const currency = input.currency ?? "MXN";
    const lines = await resolveLines(this.db, actor, input.items, currency);
    const totals = calculateTotals(lines, currency);

    const customer = input.customerId ? await this.requireInvoiceableCustomer(actor, input.customerId) : null;
    const settings = await this.requireFiscalSettings(actor);
    const warehouseId = await this.resolveWarehouse(actor, input.warehouseId, lines);
    const impacts = await this.stockImpacts(actor, warehouseId, lines, "OUT");

    const cfdiUse = input.cfdiUse ?? customer?.cfdiUseDefault ?? PUBLICO_GENERAL_RECIPIENT.cfdiUse;

    return this.proposals.create(actor, {
      kind: "INVOICE_CREATE",
      payload: {
        kind: "INGRESO",
        documentType: "INGRESO",
        customerId: input.customerId,
        currency,
        paymentForm: input.paymentForm,
        paymentMethod: input.paymentMethod,
        cfdiUse,
        placeOfIssuance: input.placeOfIssuance ?? settings.lugarExpedicion,
        warehouseId,
        lines,
        totals,
        invoiceIdempotencyKey: input.idempotencyKey,
      },
      diff: invoiceDiff({
        title: `Invoice ${customer?.displayName ?? "publico en general"}`,
        lines,
        totals,
        currency,
        impacts,
        fiscalAction: "CFDI 4.0 Ingreso",
        environment: this.environment,
      }),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Factura global: one CFDI covering a period's publico-en-general sales.
   * It has no recipient of its own, so no customer fiscal gate applies.
   */
  async prepareGlobalInvoice(actor: ActorContext, input: PrepareGlobalInvoiceInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.INVOICES_DRAFT);
    const currency = input.currency ?? "MXN";
    const lines = await resolveLines(this.db, actor, input.items, currency);
    const totals = calculateTotals(lines, currency);
    const settings = await this.requireFiscalSettings(actor);
    const warehouseId = await this.resolveWarehouse(actor, input.warehouseId, lines);
    const impacts = await this.stockImpacts(actor, warehouseId, lines, "OUT");

    return this.proposals.create(actor, {
      kind: "GLOBAL_INVOICE_CREATE",
      payload: {
        kind: "GLOBAL",
        documentType: "INGRESO",
        customerId: null,
        currency,
        paymentForm: input.paymentForm,
        // A factura global is always settled in one exhibition.
        paymentMethod: "PUE",
        cfdiUse: PUBLICO_GENERAL_RECIPIENT.cfdiUse,
        placeOfIssuance: input.placeOfIssuance ?? settings.lugarExpedicion,
        warehouseId,
        lines,
        totals,
        globalPeriod: { periodicity: input.periodicity, months: input.months, year: input.year },
        invoiceIdempotencyKey: input.idempotencyKey,
      },
      diff: invoiceDiff({
        title: `Factura global ${input.months}/${input.year}`,
        lines,
        totals,
        currency,
        impacts,
        fiscalAction: "CFDI 4.0 Ingreso (factura global)",
        environment: this.environment,
      }),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Credit note (CFDI egreso) against a stamped invoice. Defaults to the
   * whole invoice; a partial note passes the lines to credit.
   */
  async prepareCreditNote(actor: ActorContext, input: PrepareCreditNoteInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.INVOICES_DRAFT);
    const original = await this.get(actor, input.invoiceId);
    if (original.status !== "STAMPED") {
      throw new ConflictError("Only a stamped invoice can be credited", {
        invoiceId: original.id,
        status: original.status,
      });
    }
    if (!input.reason?.trim()) {
      throw new ValidationError("A credit note needs a reason", { field: "reason" });
    }

    const currency = original.currency;
    const items: InvoiceItemInput[] =
      input.items ??
      original.items.map((item) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        taxRate: item.taxRate,
      }));
    const lines = await resolveLines(this.db, actor, items, currency);
    const totals = calculateTotals(lines, currency);

    const warehouseId = await this.resolveWarehouse(actor, undefined, lines);
    const impacts = await this.stockImpacts(actor, warehouseId, lines, "IN");

    return this.proposals.create(actor, {
      kind: "CREDIT_NOTE_CREATE",
      payload: {
        kind: "EGRESO",
        documentType: "EGRESO",
        customerId: original.customerId,
        currency,
        paymentForm: input.paymentForm,
        paymentMethod: original.paymentMethod ?? "PUE",
        cfdiUse: "G02",
        placeOfIssuance: original.placeOfIssuance,
        warehouseId,
        lines,
        totals,
        relatedInvoiceId: original.id,
        relatedUuid: original.uuidFiscal,
        // SAT c_TipoRelacion "01": nota de credito de los documentos relacionados.
        relationType: "01",
        reason: input.reason.trim(),
        invoiceIdempotencyKey: input.idempotencyKey,
      },
      diff: invoiceDiff({
        title: `Credit note for invoice ${original.uuidFiscal ?? original.id}`,
        lines,
        totals,
        currency,
        impacts,
        fiscalAction: "CFDI 4.0 Egreso (nota de credito)",
        environment: this.environment,
        extraSections: [{ lines: [`Reason: ${input.reason.trim()}`] }],
      }),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async prepareCancellation(actor: ActorContext, input: PrepareCancellationInput): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.INVOICES_DRAFT);
    const invoice = await this.get(actor, input.invoiceId);
    if (invoice.status !== "STAMPED") {
      throw new ConflictError("Only a stamped invoice can be cancelled", {
        invoiceId: invoice.id,
        status: invoice.status,
      });
    }
    // SAT reason "01" is "comprobante emitido con errores con relacion", which
    // only makes sense when the replacement CFDI already exists.
    if (input.reason === "01" && !input.replacementUuid) {
      throw new ValidationError("Cancellation reason 01 needs the replacement UUID", {
        field: "replacementUuid",
      });
    }

    return this.proposals.create(actor, {
      kind: "INVOICE_CANCELLATION",
      payload: {
        invoiceId: invoice.id,
        uuid: invoice.uuidFiscal,
        reason: input.reason,
        replacementUuid: input.replacementUuid ?? null,
      },
      diff: {
        title: `Cancel invoice ${invoice.uuidFiscal ?? invoice.id}`,
        sections: [
          {
            changes: [
              { label: "Status", before: invoice.status, after: "CANCELLED" },
              { label: "Total", before: money(invoice.total, invoice.currency), after: "-" },
            ],
          },
          {
            heading: "Fiscal action:",
            lines: [
              `Cancel CFDI ${invoice.uuidFiscal ?? "(unstamped)"}`,
              `SAT reason: ${input.reason}`,
              `Environment: ${titleCase(this.environment)}`,
            ],
          },
          { lines: ["Stock from this invoice is returned by a compensating movement."] },
          { lines: ["Requires approval: YES"] },
        ],
      },
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** The "explain this invoice" read the agent narrates (docs/mvp/08-agent.md). */
  async explain(actor: ActorContext, invoiceId: string): Promise<string> {
    const invoice = await this.get(actor, invoiceId);
    const lines = invoice.items.map(
      (item) => `- ${qty(item.quantity)} x ${item.description} @ ${money(item.unitPrice, invoice.currency)}`,
    );
    return [
      `Invoice ${invoice.uuidFiscal ?? invoice.id} (${invoice.kind}, ${invoice.status})`,
      ...lines,
      `Subtotal: ${money(invoice.subtotal, invoice.currency)}`,
      `Tax: ${money(invoice.taxTotal, invoice.currency)}`,
      `Total: ${money(invoice.total, invoice.currency)}`,
    ].join("\n");
  }

  private async requireInvoiceableCustomer(actor: ActorContext, customerId: string) {
    const [customer] = await this.db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, actor.tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    if (!customer) throw new NotFoundError("Customer", customerId);

    // Non-negotiable: a CFDI the SAT would reject is never drafted as if it
    // were fine. The same deterministic check the agent narrates gates here.
    const readiness = checkFiscalReadiness(customer);
    if (!readiness.ready) {
      throw new ValidationError(`${customer.displayName} is missing fiscal data`, {
        customerId,
        missing: readiness.missing,
      });
    }
    return customer;
  }

  private async requireFiscalSettings(actor: ActorContext) {
    const settings = await new InvoiceRepository(this.db).getFiscalSettings(actor, this.environment);
    if (!settings) {
      throw new ValidationError(`No ${this.environment} fiscal settings configured for this tenant`, {
        environment: this.environment,
      });
    }
    const missing = (
      [
        ["rfcEmisor", settings.rfcEmisor],
        ["legalNameEmisor", settings.legalNameEmisor],
        ["regimenFiscal", settings.regimenFiscal],
        ["lugarExpedicion", settings.lugarExpedicion],
        ["csdCertRef", settings.csdCertRef],
        ["csdKeyRef", settings.csdKeyRef],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([field]) => field);
    if (missing.length > 0) {
      throw new ValidationError("Fiscal settings are incomplete", { environment: this.environment, missing });
    }
    return settings;
  }

  private async resolveWarehouse(
    actor: ActorContext,
    warehouseId: string | undefined,
    lines: ResolvedLine[],
  ): Promise<string | null> {
    if (warehouseId) return warehouseId;
    if (!lines.some((line) => line.tracksInventory)) return null;

    const warehouse = await new InventoryRepository(this.db).getDefaultWarehouse(actor);
    if (!warehouse) {
      throw new ValidationError("This invoice moves stock but the tenant has no default warehouse", {});
    }
    return warehouse.id;
  }

  private async stockImpacts(
    actor: ActorContext,
    warehouseId: string | null,
    lines: ResolvedLine[],
    direction: "IN" | "OUT",
  ): Promise<StockImpact[]> {
    if (!warehouseId) return [];
    const repo = new InventoryRepository(this.db);

    const impacts: StockImpact[] = [];
    for (const line of lines) {
      if (!line.tracksInventory || !line.productId) continue;
      const before = new Decimal(await repo.getQuantityOnHand(actor, warehouseId, line.productId));
      const delta = new Decimal(line.quantity);
      impacts.push({
        productId: line.productId,
        sku: line.sku ?? line.description,
        quantityBefore: before.toString(),
        quantityAfter: (direction === "OUT" ? before.minus(delta) : before.plus(delta)).toString(),
      });
    }
    return impacts;
  }
}

/**
 * Turns caller items into priced lines. Product defaults (name, price, tax
 * rate, SAT codes) are read once here so the proposal payload freezes exactly
 * what the approver saw, and execution never re-prices behind their back.
 */
export async function resolveLines(
  db: DbClient,
  scope: ActorContext,
  items: InvoiceItemInput[],
  currency: string,
): Promise<ResolvedLine[]> {
  if (items.length === 0) throw new ValidationError("An invoice needs at least one line", { field: "items" });

  const productIds = items.map((item) => item.productId).filter((id): id is string => Boolean(id));
  const products = productIds.length
    ? await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.tenantId, scope.tenantId), inArray(schema.products.id, productIds)))
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));

  return items.map((item) => {
    const product = item.productId ? byId.get(item.productId) : undefined;
    if (item.productId && !product) throw new NotFoundError("Product", item.productId);

    const quantity = new Decimal(item.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new ValidationError("Line quantity must be positive", { quantity: item.quantity });
    }

    const description = item.description ?? product?.name;
    if (!description) {
      throw new ValidationError("A line without a product needs a description", { field: "description" });
    }
    const unitPrice = item.unitPrice ?? product?.salePrice;
    if (unitPrice === undefined) {
      throw new ValidationError("A line without a product needs a unit price", { field: "unitPrice" });
    }
    if (new Decimal(unitPrice).isNegative()) {
      throw new ValidationError("Line unit price cannot be negative", { unitPrice });
    }

    const taxRate = item.taxRate ?? product?.taxRate ?? "0.16";
    const amounts = calculateLine(
      { quantity: item.quantity, unitPrice, discount: item.discount, taxRate },
      currency,
    );

    return {
      productId: product?.id ?? null,
      description,
      quantity: item.quantity,
      unitPrice,
      discount: item.discount ?? "0",
      taxRate,
      taxAmount: amounts.taxAmount,
      total: amounts.total,
      base: amounts.base,
      tracksInventory: product?.trackInventory ?? false,
      sku: product?.sku ?? null,
      satProductCode: product?.satProductCode ?? FREE_TEXT_PRODUCT_CODE,
      satUnitCode: product?.satUnitCode ?? FREE_TEXT_UNIT_CODE,
      unit: product?.internalUnit ?? "pza",
    };
  });
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** Mirrors the invoice diff in docs/mvp/09-proposals-and-governance.md. */
function invoiceDiff(input: {
  title: string;
  lines: ResolvedLine[];
  totals: InvoiceTotals;
  currency: string;
  impacts: StockImpact[];
  fiscalAction: string;
  environment: FiscalEnvironment;
  extraSections?: BusinessDiff["sections"];
}): BusinessDiff {
  const sections: BusinessDiff["sections"] = [
    {
      lines: input.lines.map(
        (line) => `+ ${qty(line.quantity)} × ${line.sku ?? line.description}`,
      ),
    },
    {
      lines: [
        `Subtotal: ${money(input.totals.subtotal, input.currency)}`,
        `IVA:      ${money(input.totals.taxTotal, input.currency)}`,
        `Total:    ${money(input.totals.total, input.currency)}`,
      ],
    },
  ];

  if (input.impacts.length > 0) {
    sections.push({
      heading: "Inventory impact:",
      lines: input.impacts.map((i) => `${i.sku}: ${i.quantityBefore} → ${i.quantityAfter}`),
    });
  }

  sections.push({
    heading: "Fiscal action:",
    lines: [input.fiscalAction, `Environment: ${titleCase(input.environment)}`],
  });
  sections.push(...(input.extraSections ?? []));
  sections.push({ lines: ["Requires approval: YES"] });

  return { title: input.title, sections };
}
