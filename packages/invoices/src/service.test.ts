import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import { schema } from "@maicora/database";
import { eq } from "drizzle-orm";
import type { ActorContext } from "@maicora/shared";
import { newId, ValidationError } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { InventoryService, inventoryAdjustmentExecutor } from "@maicora/inventory";
import { StubFiscalEngine } from "@maicora/cfdi";
import { InvoiceService } from "./service.js";
import { invoiceCancellationExecutor, invoiceStampExecutor } from "./executors.js";

const dbReachable = await isTestDbReachable();

describe.skipIf(!dbReachable)("InvoiceService (integration)", () => {
  const db = getTestDb();
  const engine = new StubFiscalEngine();
  const registry = new ExecutorRegistry();
  registry.register("INVENTORY_ADJUSTMENT", inventoryAdjustmentExecutor);
  for (const kind of ["INVOICE_CREATE", "GLOBAL_INVOICE_CREATE", "CREDIT_NOTE_CREATE"] as const) {
    registry.register(kind, invoiceStampExecutor({ engine }));
  }
  registry.register("INVOICE_CANCELLATION", invoiceCancellationExecutor({ engine }));

  const proposals = new ProposalService(db, registry);
  const inventory = new InventoryService(db, proposals);
  const invoices = new InvoiceService(db, proposals);

  let actor: ActorContext;
  let customerId: string;
  let productA: string;
  let productB: string;

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };

    await db.insert(schema.fiscalSettings).values({
      id: newId(),
      tenantId: tenant.tenantId,
      environment: "SANDBOX",
      rfcEmisor: "EKU9003173C9",
      legalNameEmisor: "ESCUELA KEMPER URGATE",
      regimenFiscal: "601",
      lugarExpedicion: "64000",
      csdCertRef: "ref:cert",
      csdKeyRef: "ref:key",
    });

    customerId = newId();
    await db.insert(schema.customers).values({
      id: customerId,
      tenantId: tenant.tenantId,
      displayName: "ACME SA de CV",
      legalName: "ACME SA DE CV",
      rfc: "TNO950101AB1",
      taxRegime: "601",
      fiscalPostalCode: "64000",
      email: "pagos@acme.mx",
    });

    productA = newId();
    productB = newId();
    await db.insert(schema.products).values([
      {
        id: productA,
        tenantId: tenant.tenantId,
        sku: "SKU-123",
        name: "Widget",
        salePrice: "600.00",
        satProductCode: "01010101",
        satUnitCode: "H87",
      },
      {
        id: productB,
        tenantId: tenant.tenantId,
        sku: "SKU-456",
        name: "Gadget",
        salePrice: "600.00",
        satProductCode: "01010101",
        satUnitCode: "H87",
      },
    ]);

    await inventory.createWarehouse(actor, { name: "Main", code: "MAIN", isDefault: true });
    await stockUp(productA, "54");
    await stockUp(productB, "18");
  });

  async function stockUp(productId: string, quantity: string) {
    const proposal = await inventory.prepareAdjustment(actor, {
      productId,
      countedQuantity: quantity,
      reason: "Opening count",
      idempotencyKey: `open-${productId}`,
    });
    await proposals.approve(actor, proposal.id);
    await proposals.execute(actor, proposal.id);
  }

  async function draftSpecInvoice(idempotencyKey = "inv-1") {
    return invoices.prepareInvoice(actor, {
      customerId,
      items: [
        { productId: productA, quantity: "10" },
        { productId: productB, quantity: "4" },
      ],
      paymentForm: "03",
      paymentMethod: "PUE",
      cfdiUse: "G03",
      idempotencyKey,
    });
  }

  async function onHand(productId: string): Promise<string> {
    const [level] = await inventory.getStock(actor, { productId });
    return level?.quantityOnHand ?? "0";
  }

  it("drafts the spec's invoice diff without writing or stamping anything", async () => {
    const proposal = await draftSpecInvoice();

    expect(proposal.kind).toBe("INVOICE_CREATE");
    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.diff.title).toBe("Invoice ACME SA de CV");
    expect(proposal.diff.sections[0]?.lines).toEqual(["+ 10 × SKU-123", "+ 4 × SKU-456"]);
    expect(proposal.diff.sections[1]?.lines).toEqual([
      "Subtotal: MXN 8,400.00",
      "IVA:      MXN 1,344.00",
      "Total:    MXN 9,744.00",
    ]);
    expect(proposal.diff.sections[2]).toEqual({
      heading: "Inventory impact:",
      lines: ["SKU-123: 54 → 44", "SKU-456: 18 → 14"],
    });

    expect(await invoices.search(actor, {})).toHaveLength(0);
    expect(await onHand(productA)).toBe("54.000000");
  });

  it("stamps, persists and deducts stock only after approval", async () => {
    const proposal = await draftSpecInvoice();
    await proposals.approve(actor, proposal.id);
    const { changeset } = await proposals.execute(actor, proposal.id);

    const invoice = await invoices.get(actor, String(changeset?.entityId));
    expect(invoice.status).toBe("STAMPED");
    expect(invoice.uuidFiscal).toBeTruthy();
    expect(invoice.total).toBe("9744.000000");
    expect(invoice.items).toHaveLength(2);

    expect(await onHand(productA)).toBe("44.000000");
    expect(await onHand(productB)).toBe("14.000000");

    // Non-negotiable #7: the deduction exists as a ledger movement.
    const movements = await inventory.getMovements(actor, { productId: productA });
    expect(movements.some((m) => m.movementType === "INVOICE_OUT" && m.direction === "OUT")).toBe(true);
  });

  it("refuses to draft an invoice for a customer missing fiscal data", async () => {
    const incompleteId = newId();
    await db.insert(schema.customers).values({
      id: incompleteId,
      tenantId: actor.tenantId,
      displayName: "Taller Norte",
    });

    await expect(
      invoices.prepareInvoice(actor, {
        customerId: incompleteId,
        items: [{ productId: productA, quantity: "1" }],
        paymentForm: "03",
        paymentMethod: "PUE",
        idempotencyKey: "inv-incomplete",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks an invoice that would drive stock negative, leaving nothing written", async () => {
    const proposal = await invoices.prepareInvoice(actor, {
      customerId,
      items: [{ productId: productA, quantity: "999" }],
      paymentForm: "03",
      paymentMethod: "PUE",
      idempotencyKey: "inv-oversold",
    });
    await proposals.approve(actor, proposal.id);

    await expect(proposals.execute(actor, proposal.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await invoices.search(actor, {})).toHaveLength(0);
    expect(await onHand(productA)).toBe("54.000000");
  });

  it("leaves no invoice and no stock movement when the PAC refuses the stamp", async () => {
    const proposal = await draftSpecInvoice("inv-pac-down");
    await proposals.approve(actor, proposal.id);
    engine.failNextStamp = "CSD expired";

    await expect(proposals.execute(actor, proposal.id)).rejects.toThrow("CSD expired");
    expect(await invoices.search(actor, {})).toHaveLength(0);
    expect(await onHand(productA)).toBe("54.000000");
  });

  it("does not stamp a second CFDI when an executed proposal is executed again", async () => {
    const proposal = await draftSpecInvoice();
    await proposals.approve(actor, proposal.id);
    const first = await proposals.execute(actor, proposal.id);
    const second = await proposals.execute(actor, proposal.id);

    expect(second.changeset?.id).toBe(first.changeset?.id);
    expect(await invoices.search(actor, {})).toHaveLength(1);
  });

  it("credits a stamped invoice back into stock with an egreso CFDI", async () => {
    const sale = await draftSpecInvoice();
    await proposals.approve(actor, sale.id);
    const executed = await proposals.execute(actor, sale.id);
    const invoiceId = String(executed.changeset?.entityId);

    const note = await invoices.prepareCreditNote(actor, {
      invoiceId,
      paymentForm: "03",
      reason: "Customer returned the shipment",
      idempotencyKey: "cn-1",
    });
    expect(note.kind).toBe("CREDIT_NOTE_CREATE");

    await proposals.approve(actor, note.id);
    const { changeset } = await proposals.execute(actor, note.id);

    const creditNote = await invoices.get(actor, String(changeset?.entityId));
    expect(creditNote.kind).toBe("EGRESO");
    expect(creditNote.relatedInvoiceId).toBe(invoiceId);
    expect(creditNote.status).toBe("STAMPED");

    expect(await onHand(productA)).toBe("54.000000");
    expect(await onHand(productB)).toBe("18.000000");
  });

  it("cancels a stamped invoice and returns exactly the stock it deducted", async () => {
    const sale = await draftSpecInvoice();
    await proposals.approve(actor, sale.id);
    const executed = await proposals.execute(actor, sale.id);
    const invoiceId = String(executed.changeset?.entityId);

    const cancellation = await invoices.prepareCancellation(actor, {
      invoiceId,
      reason: "02",
      idempotencyKey: "cancel-1",
    });
    await proposals.approve(actor, cancellation.id);
    await proposals.execute(actor, cancellation.id);

    const cancelled = await invoices.get(actor, invoiceId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toBe("02");
    expect(await onHand(productA)).toBe("54.000000");
    expect(await onHand(productB)).toBe("18.000000");
  });

  it("issues a factura global with no recipient and the period attached", async () => {
    const proposal = await invoices.prepareGlobalInvoice(actor, {
      items: [{ productId: productA, quantity: "2" }],
      paymentForm: "01",
      periodicity: "04",
      months: "01",
      year: 2026,
      idempotencyKey: "global-1",
    });
    expect(proposal.kind).toBe("GLOBAL_INVOICE_CREATE");
    expect(proposal.diff.title).toBe("Factura global 01/2026");

    await proposals.approve(actor, proposal.id);
    const { changeset } = await proposals.execute(actor, proposal.id);

    const invoice = await invoices.get(actor, String(changeset?.entityId));
    expect(invoice.kind).toBe("GLOBAL");
    expect(invoice.customerId).toBeNull();
    expect(invoice.status).toBe("STAMPED");
    expect(await onHand(productA)).toBe("52.000000");
  });

  it("keeps invoices of another tenant invisible", async () => {
    const sale = await draftSpecInvoice();
    await proposals.approve(actor, sale.id);
    await proposals.execute(actor, sale.id);

    const other = await seedTenant(db, { tenantName: "Otro", userEmail: "otro@example.com" });
    const otherActor: ActorContext = {
      ...other,
      roles: ["OWNER"],
      permissions: permissionsForRole("OWNER"),
    };

    expect(await invoices.search(otherActor, {})).toHaveLength(0);
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, actor.tenantId));
    await expect(invoices.get(otherActor, String(row?.id))).rejects.toThrow();
  });
});
