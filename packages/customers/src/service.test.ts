import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import { schema } from "@maicora/database";
import type { ActorContext } from "@maicora/shared";
import { newId } from "@maicora/shared";
import { permissionsForRole } from "@maicora/tenancy";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { CustomerService, customerCreateExecutor, customerUpdateExecutor } from "./service.js";
import type { CustomerInput } from "./types.js";

const dbReachable = await isTestDbReachable();

const tallerNorte: CustomerInput = {
  displayName: "Taller Norte",
  legalName: "Taller Norte SA de CV",
  rfc: "TNO950101AB1",
  taxRegime: "601",
  fiscalPostalCode: "64000",
  email: "facturas@tallernorte.mx",
  tags: ["mayorista"],
};

describe.skipIf(!dbReachable)("CustomerService (integration)", () => {
  const db = getTestDb();
  const registry = new ExecutorRegistry();
  registry.register("CUSTOMER_CREATE", customerCreateExecutor);
  registry.register("CUSTOMER_UPDATE", customerUpdateExecutor);
  const proposals = new ProposalService(db, registry);
  const customers = new CustomerService(db, proposals);

  let actor: ActorContext;

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };
  });

  it("self-approves a customer create and only writes the row once executed", async () => {
    const proposal = await customers.prepareCreate(actor, tallerNorte, { idempotencyKey: "cust-taller-1" });

    // CUSTOMER_CREATE is DRAFT risk: no human approval step, but still no write
    // until the proposal executes.
    expect(proposal.kind).toBe("CUSTOMER_CREATE");
    expect(proposal.status).toBe("APPROVED");
    expect(proposal.diff.title).toBe("New customer: Taller Norte");
    expect(await customers.search(actor, {})).toHaveLength(0);

    const { changeset } = await proposals.execute(actor, proposal.id);

    expect(changeset?.entityType).toBe("customer");
    expect(changeset?.action).toBe("CREATE");
    const [created] = await customers.search(actor, { query: "TNO950101" });
    expect(created?.displayName).toBe("Taller Norte");
    expect(created?.rfc).toBe("TNO950101AB1");
    expect(created?.tags).toEqual(["mayorista"]);
  });

  it("diffs a customer update and applies only the patched fields", async () => {
    const created = await execCreate(customers, proposals, actor, {
      displayName: "Panaderia Sol",
      rfc: "PSO900101QT4",
      email: "hola@panaderiasol.mx",
    });

    const proposal = await customers.prepareUpdate(
      actor,
      created.id,
      { email: "facturacion@panaderiasol.mx", taxRegime: "612" },
      { idempotencyKey: "cust-sol-update-1" },
    );

    expect(proposal.diff.sections[0]?.changes).toEqual([
      { label: "Tax regime", before: "not set", after: "612" },
      { label: "Email", before: "hola@panaderiasol.mx", after: "facturacion@panaderiasol.mx" },
    ]);

    const { changeset } = await proposals.execute(actor, proposal.id);
    expect(changeset?.before).toEqual({ email: "hola@panaderiasol.mx", taxRegime: null });

    const after = await customers.get(actor, created.id);
    expect(after.email).toBe("facturacion@panaderiasol.mx");
    expect(after.taxRegime).toBe("612");
    // Untouched fields survive the patch.
    expect(after.rfc).toBe("PSO900101QT4");
  });

  it("hides archived customers from search unless asked for them", async () => {
    const created = await execCreate(customers, proposals, actor, { displayName: "Cliente Viejo" });

    await customers.archive(actor, created.id);

    expect(await customers.search(actor, {})).toHaveLength(0);
    expect(await customers.search(actor, { includeArchived: true })).toHaveLength(1);
  });

  it("lists only the customers whose missing fiscal data blocks invoicing", async () => {
    await execCreate(customers, proposals, actor, tallerNorte);
    await execCreate(customers, proposals, actor, { displayName: "Sin Datos" });
    await execCreate(customers, proposals, actor, { displayName: "Mostrador", kind: "PUBLICO_GENERAL" });

    const blocked = await customers.findCustomersMissingFiscalData(actor);

    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.displayName).toBe("Sin Datos");
    expect(blocked[0]?.missing).toEqual([
      "RFC",
      "Legal/fiscal name",
      "Fiscal postal code",
      "Tax regime",
      "Email",
    ]);
  });

  it("returns invoice history scoped to the one customer, newest first", async () => {
    const mine = await execCreate(customers, proposals, actor, tallerNorte);
    const other = await execCreate(customers, proposals, actor, { displayName: "Otro Cliente" });

    await db.insert(schema.invoices).values([
      {
        id: newId(),
        tenantId: actor.tenantId,
        customerId: mine.id,
        total: "100.00",
        idempotencyKey: "inv-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: newId(),
        tenantId: actor.tenantId,
        customerId: mine.id,
        total: "250.00",
        idempotencyKey: "inv-2",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
      { id: newId(), tenantId: actor.tenantId, customerId: other.id, total: "999.00", idempotencyKey: "inv-3" },
    ]);

    const history = await customers.getInvoiceHistory(actor, mine.id);

    expect(history.map((i) => i.total)).toEqual(["250.000000", "100.000000"]);
  });
});

/** Proposal + execute in one step, for the rows a test needs to already exist. */
async function execCreate(
  customers: CustomerService,
  proposals: ProposalService,
  actor: ActorContext,
  input: CustomerInput,
) {
  const proposal = await customers.prepareCreate(actor, input, { idempotencyKey: `seed-${input.displayName}` });
  const { changeset } = await proposals.execute(actor, proposal.id);
  if (!changeset) throw new Error(`Customer ${input.displayName} was not created`);
  return customers.get(actor, changeset.entityId);
}
