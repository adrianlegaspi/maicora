import { and, desc, eq, type SQL } from "drizzle-orm";
import { schema, type DbClient } from "@maicora/database";
import { newId, type TenantScope } from "@maicora/shared";
import type { InvoiceSearchParams, InvoiceStatus, ResolvedLine } from "./types.js";

export type InvoiceRow = typeof schema.invoices.$inferSelect;
export type InvoiceItemRow = typeof schema.invoiceItems.$inferSelect;
export type FiscalSettingsRow = typeof schema.fiscalSettings.$inferSelect;

export interface InvoiceWithItems extends InvoiceRow {
  items: InvoiceItemRow[];
}

export interface InsertInvoiceInput {
  id: string;
  customerId: string | null;
  kind: "INGRESO" | "EGRESO" | "GLOBAL";
  status: InvoiceStatus;
  environment: "SANDBOX" | "PRODUCTION";
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paymentForm: string | null;
  paymentMethod: string | null;
  cfdiUse: string | null;
  placeOfIssuance: string | null;
  relatedInvoiceId: string | null;
  idempotencyKey: string;
  lines: ResolvedLine[];
}

export class InvoiceRepository {
  constructor(private readonly db: DbClient) {}

  async get(scope: TenantScope, invoiceId: string): Promise<InvoiceWithItems | null> {
    const [invoice] = await this.db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.tenantId, scope.tenantId), eq(schema.invoices.id, invoiceId)))
      .limit(1);
    if (!invoice) return null;

    const items = await this.db
      .select()
      .from(schema.invoiceItems)
      .where(
        and(eq(schema.invoiceItems.tenantId, scope.tenantId), eq(schema.invoiceItems.invoiceId, invoiceId)),
      )
      .orderBy(schema.invoiceItems.lineNumber);

    return { ...invoice, items };
  }

  async search(scope: TenantScope, params: InvoiceSearchParams = {}): Promise<InvoiceRow[]> {
    const filters: (SQL | undefined)[] = [eq(schema.invoices.tenantId, scope.tenantId)];
    if (params.customerId) filters.push(eq(schema.invoices.customerId, params.customerId));
    if (params.status) filters.push(eq(schema.invoices.status, params.status));
    if (params.kind) filters.push(eq(schema.invoices.kind, params.kind));

    return this.db
      .select()
      .from(schema.invoices)
      .where(and(...filters))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);
  }

  /** Writes the header and its lines together; callers always hold a transaction. */
  async insert(scope: TenantScope, input: InsertInvoiceInput): Promise<InvoiceRow> {
    const [invoice] = await this.db
      .insert(schema.invoices)
      .values({
        id: input.id,
        tenantId: scope.tenantId,
        customerId: input.customerId,
        kind: input.kind,
        status: input.status,
        environment: input.environment,
        currency: input.currency,
        subtotal: input.subtotal,
        taxTotal: input.taxTotal,
        total: input.total,
        paymentForm: input.paymentForm,
        paymentMethod: input.paymentMethod,
        cfdiUse: input.cfdiUse,
        placeOfIssuance: input.placeOfIssuance,
        relatedInvoiceId: input.relatedInvoiceId,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    if (!invoice) throw new Error("Failed to insert invoice");

    if (input.lines.length > 0) {
      await this.db.insert(schema.invoiceItems).values(
        input.lines.map((line, index) => ({
          id: newId(),
          tenantId: scope.tenantId,
          invoiceId: invoice.id,
          productId: line.productId,
          lineNumber: index + 1,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          total: line.total,
        })),
      );
    }

    return invoice;
  }

  async markStamped(
    scope: TenantScope,
    invoiceId: string,
    stamp: { uuid: string; xmlStoragePath: string; stampedAt: Date },
  ): Promise<InvoiceRow> {
    return this.updateInvoice(scope, invoiceId, {
      status: "STAMPED",
      uuidFiscal: stamp.uuid,
      xmlStoragePath: stamp.xmlStoragePath,
      stampedAt: stamp.stampedAt,
    });
  }

  async markCancelled(
    scope: TenantScope,
    invoiceId: string,
    cancellation: { reason: string; cancelledAt: Date },
  ): Promise<InvoiceRow> {
    return this.updateInvoice(scope, invoiceId, {
      status: "CANCELLED",
      cancellationReason: cancellation.reason,
      cancelledAt: cancellation.cancelledAt,
    });
  }

  async markError(scope: TenantScope, invoiceId: string): Promise<InvoiceRow> {
    return this.updateInvoice(scope, invoiceId, { status: "ERROR" });
  }

  private async updateInvoice(
    scope: TenantScope,
    invoiceId: string,
    values: Partial<typeof schema.invoices.$inferInsert>,
  ): Promise<InvoiceRow> {
    const [row] = await this.db
      .update(schema.invoices)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.invoices.tenantId, scope.tenantId), eq(schema.invoices.id, invoiceId)))
      .returning();
    if (!row) throw new Error(`Invoice ${invoiceId} not found for update`);
    return row;
  }

  async getFiscalSettings(
    scope: TenantScope,
    environment: "SANDBOX" | "PRODUCTION",
  ): Promise<FiscalSettingsRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.fiscalSettings)
      .where(
        and(
          eq(schema.fiscalSettings.tenantId, scope.tenantId),
          eq(schema.fiscalSettings.environment, environment),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
