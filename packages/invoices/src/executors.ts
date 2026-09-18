import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { ConflictError, newId, NotFoundError, ValidationError, type ActorContext } from "@maicora/shared";
import { schema, type Tx } from "@maicora/database";
import type { Executor } from "@maicora/proposals";
import { InventoryRepository } from "@maicora/inventory";
import type { CfdiConcept, CfdiIssuer, CfdiRecipient, FiscalEngine, FiscalEnvironment } from "@maicora/cfdi";
import { InvoiceRepository, type FiscalSettingsRow } from "./repository.js";
import { PUBLICO_GENERAL_RECIPIENT, type InvoiceServiceOptions } from "./service.js";
import { saveCfdiXml } from "./storage.js";
import type { ResolvedLine } from "./types.js";

export interface InvoiceExecutorDeps extends InvoiceServiceOptions {
  /**
   * The one runtime dependency an invoice executor cannot resolve itself, so
   * these executors are built by a factory where every other domain's is a
   * plain const.
   */
  engine: FiscalEngine;
}

/**
 * Applies an approved INVOICE_CREATE, GLOBAL_INVOICE_CREATE or
 * CREDIT_NOTE_CREATE: persist the invoice, move stock through the ledger,
 * then stamp with the PAC. Register the same executor for all three kinds -
 * the payload carries which document it is.
 *
 * The stamp call happens inside the database transaction so a PAC refusal
 * leaves no half-invoice and no phantom stock movement. The engine's
 * idempotency key makes the reverse case safe too: if the stamp succeeds and
 * the transaction then fails, the retry gets the original stamp back rather
 * than a second CFDI.
 */
export function invoiceStampExecutor(deps: InvoiceExecutorDeps): Executor {
  const environment = deps.environment ?? "SANDBOX";
  const negativeStock = deps.negativeStock ?? "BLOCK";

  return async ({ tx, actor, payload, proposalId, changesetId }) => {
    const repo = new InvoiceRepository(tx);
    const settings = await requireSettings(repo, actor, environment);

    const lines = payload.lines as ResolvedLine[];
    const totals = payload.totals as { subtotal: string; taxTotal: string; total: string };
    const documentType = payload.documentType === "EGRESO" ? "EGRESO" : "INGRESO";
    const kind = payload.kind as "INGRESO" | "EGRESO" | "GLOBAL";
    const currency = String(payload.currency);
    const invoiceId = newId();

    await repo.insert(actor, {
      id: invoiceId,
      customerId: payload.customerId == null ? null : String(payload.customerId),
      kind,
      status: "APPROVED",
      environment,
      currency,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      paymentForm: payload.paymentForm == null ? null : String(payload.paymentForm),
      paymentMethod: payload.paymentMethod == null ? null : String(payload.paymentMethod),
      cfdiUse: payload.cfdiUse == null ? null : String(payload.cfdiUse),
      placeOfIssuance: payload.placeOfIssuance == null ? null : String(payload.placeOfIssuance),
      relatedInvoiceId: payload.relatedInvoiceId == null ? null : String(payload.relatedInvoiceId),
      idempotencyKey: String(payload.invoiceIdempotencyKey),
      lines,
    });

    // A credit note gives stock back; a sale takes it away.
    const direction = documentType === "EGRESO" ? "IN" : "OUT";
    const warehouseId = payload.warehouseId == null ? null : String(payload.warehouseId);
    if (warehouseId) {
      await moveStock(tx, actor, {
        warehouseId,
        lines,
        direction,
        invoiceId,
        changesetId,
        negativeStock,
        movementType: documentType === "EGRESO" ? "INVOICE_REVERSAL" : "INVOICE_OUT",
      });
    }

    const recipient = await resolveRecipient(tx, actor, kind, payload);
    const stamp = await deps.engine.stamp({
      environment,
      // Keyed on the proposal, so re-executing an already-stamped proposal
      // returns that same CFDI instead of issuing a duplicate to the SAT.
      idempotencyKey: `proposal:${proposalId}`,
      documentType,
      issuer: toIssuer(settings),
      recipient,
      currency,
      paymentForm: String(payload.paymentForm),
      paymentMethod: String(payload.paymentMethod),
      concepts: lines.map(toConcept),
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      ...(payload.relatedUuid ? { relatedUuid: String(payload.relatedUuid) } : {}),
      ...(payload.relationType ? { relationType: String(payload.relationType) } : {}),
      ...(payload.globalPeriod
        ? { globalPeriod: payload.globalPeriod as { periodicity: string; months: string; year: number } }
        : {}),
    });

    const invoice = await repo.markStamped(actor, invoiceId, {
      uuid: stamp.uuid,
      xmlStoragePath: await saveCfdiXml(actor.tenantId, stamp.uuid, stamp.xml),
      stampedAt: new Date(stamp.stampedAt),
    });

    return {
      entityType: "invoice",
      entityId: invoiceId,
      action: "CREATE",
      before: null,
      after: { uuid: stamp.uuid, status: invoice.status, total: invoice.total },
      // A stamped CFDI is undone by cancelling it at the SAT, never by
      // deleting the row (docs/mvp/09-proposals-and-governance.md).
      reversible: false,
      result: { invoiceId, uuid: stamp.uuid, total: invoice.total, currency },
    };
  };
}

/**
 * Applies an approved INVOICE_CANCELLATION: cancel at the SAT, then give the
 * stock back with compensating movements derived from the ledger rows the
 * original invoice wrote, so the reversal matches exactly what was deducted.
 */
export function invoiceCancellationExecutor(deps: InvoiceExecutorDeps): Executor {
  const environment = deps.environment ?? "SANDBOX";

  return async ({ tx, actor, payload, changesetId }) => {
    const repo = new InvoiceRepository(tx);
    const invoiceId = String(payload.invoiceId);
    const invoice = await repo.get(actor, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice", invoiceId);
    if (invoice.status !== "STAMPED") {
      throw new ConflictError("Only a stamped invoice can be cancelled", {
        invoiceId,
        status: invoice.status,
      });
    }
    if (!invoice.uuidFiscal) {
      throw new ConflictError("Invoice has no fiscal UUID to cancel", { invoiceId });
    }

    const settings = await requireSettings(repo, actor, environment);
    const reason = String(payload.reason);
    const cancellation = await deps.engine.cancel({
      environment,
      idempotencyKey: `cancel:${invoiceId}`,
      issuer: toIssuer(settings),
      uuid: invoice.uuidFiscal,
      reason,
      ...(payload.replacementUuid ? { replacementUuid: String(payload.replacementUuid) } : {}),
    });

    const inventory = new InventoryRepository(tx);
    const original = await tx
      .select()
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.tenantId, actor.tenantId),
          eq(schema.inventoryMovements.source, `invoice:${invoiceId}`),
        ),
      );
    for (const movement of original) {
      await inventory.recordMovement(actor, {
        warehouseId: movement.warehouseId,
        productId: movement.productId,
        movementType: "INVOICE_REVERSAL",
        direction: movement.direction === "OUT" ? "IN" : "OUT",
        quantity: movement.quantity,
        source: `invoice-cancel:${invoiceId}`,
        actorId: actor.userId,
        changesetId,
        reason: `Cancellation of invoice ${invoice.uuidFiscal}`,
      });
    }

    const cancelled = await repo.markCancelled(actor, invoiceId, {
      reason,
      cancelledAt: new Date(cancellation.cancelledAt),
    });

    return {
      entityType: "invoice",
      entityId: invoiceId,
      action: "CANCEL",
      before: { status: "STAMPED", uuid: invoice.uuidFiscal },
      after: { status: cancelled.status, satStatus: cancellation.status },
      reversible: false,
      result: {
        invoiceId,
        uuid: invoice.uuidFiscal,
        satStatus: cancellation.status,
        reversedMovements: original.length,
      },
    };
  };
}

async function moveStock(
  tx: Tx,
  actor: ActorContext,
  input: {
    warehouseId: string;
    lines: ResolvedLine[];
    direction: "IN" | "OUT";
    invoiceId: string;
    changesetId: string;
    negativeStock: "BLOCK" | "ALLOW";
    movementType: "INVOICE_OUT" | "INVOICE_REVERSAL";
  },
): Promise<void> {
  const inventory = new InventoryRepository(tx);

  for (const line of input.lines) {
    if (!line.tracksInventory || !line.productId) continue;

    if (input.direction === "OUT" && input.negativeStock === "BLOCK") {
      const onHand = new Decimal(
        await inventory.getQuantityOnHand(actor, input.warehouseId, line.productId),
      );
      if (onHand.lessThan(line.quantity)) {
        throw new ValidationError(`Not enough stock for ${line.sku ?? line.description}`, {
          productId: line.productId,
          sku: line.sku,
          onHand: onHand.toString(),
          requested: line.quantity,
        });
      }
    }

    await inventory.recordMovement(actor, {
      warehouseId: input.warehouseId,
      productId: line.productId,
      movementType: input.movementType,
      direction: input.direction,
      quantity: line.quantity,
      source: `invoice:${input.invoiceId}`,
      actorId: actor.userId,
      changesetId: input.changesetId,
      reason: null,
    });
  }
}

async function requireSettings(
  repo: InvoiceRepository,
  actor: ActorContext,
  environment: FiscalEnvironment,
): Promise<FiscalSettingsRow> {
  const settings = await repo.getFiscalSettings(actor, environment);
  if (!settings?.rfcEmisor || !settings.csdCertRef || !settings.csdKeyRef) {
    throw new ValidationError(`No usable ${environment} fiscal settings for this tenant`, { environment });
  }
  return settings;
}

function toIssuer(settings: FiscalSettingsRow): CfdiIssuer {
  return {
    rfc: settings.rfcEmisor ?? "",
    name: settings.legalNameEmisor ?? "",
    regimenFiscal: settings.regimenFiscal ?? "",
    lugarExpedicion: settings.lugarExpedicion ?? "",
    csdCertRef: settings.csdCertRef ?? "",
    csdKeyRef: settings.csdKeyRef ?? "",
  };
}

async function resolveRecipient(
  tx: Tx,
  actor: ActorContext,
  kind: "INGRESO" | "EGRESO" | "GLOBAL",
  payload: Record<string, unknown>,
): Promise<CfdiRecipient | null> {
  // A factura global has no receptor of its own: the engine issues it to the
  // generic RFC with the period node attached.
  if (kind === "GLOBAL") return null;

  const customerId = payload.customerId == null ? null : String(payload.customerId);
  if (!customerId) {
    return { ...PUBLICO_GENERAL_RECIPIENT, fiscalPostalCode: String(payload.placeOfIssuance ?? "") };
  }

  const [customer] = await tx
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, actor.tenantId), eq(schema.customers.id, customerId)))
    .limit(1);
  if (!customer) throw new NotFoundError("Customer", customerId);

  return {
    rfc: customer.rfc ?? "",
    name: customer.legalName ?? customer.displayName,
    fiscalPostalCode: customer.fiscalPostalCode ?? "",
    regimenFiscal: customer.taxRegime ?? "",
    cfdiUse: String(payload.cfdiUse ?? customer.cfdiUseDefault ?? "G03"),
  };
}

function toConcept(line: ResolvedLine): CfdiConcept {
  return {
    satProductCode: line.satProductCode ?? "01010101",
    satUnitCode: line.satUnitCode ?? "ACT",
    unit: line.unit,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    amount: line.base,
  };
}
