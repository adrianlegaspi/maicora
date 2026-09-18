import { getTestDb, seedTenant, truncateAll } from "@maicora/database/testing";
import { schema, type Database } from "@maicora/database";
import { newId, type ActorContext } from "@maicora/shared";
import { permissionsForRole, type MembershipRole } from "@maicora/tenancy";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { CustomerService, customerCreateExecutor, customerUpdateExecutor } from "@maicora/customers";
import { CatalogService } from "@maicora/catalog";
import { InventoryService, inventoryAdjustmentExecutor } from "@maicora/inventory";
import { PricingService, priceUpdateExecutor } from "@maicora/pricing";
import { InvoiceService, invoiceCancellationExecutor, invoiceStampExecutor } from "@maicora/invoices";
import { StubFiscalEngine } from "@maicora/cfdi";
import { buildCapabilities, CapabilityRegistry } from "@maicora/capabilities";
import { AgentService, FakeProvider, type AgentEvent, type FakeTurn } from "@maicora/agent";

/**
 * The evals run against the same wiring the API boots: real services, the
 * real capability registry, a real database. Only the model is swapped for a
 * scripted one, because what these tests check is what the system does with a
 * model's request - not the model's prose (docs/mvp/12-agent-evaluations.md).
 */
export interface Stack {
  db: Database;
  proposals: ProposalService;
  customers: CustomerService;
  catalog: CatalogService;
  inventory: InventoryService;
  pricing: PricingService;
  invoices: InvoiceService;
  capabilities: CapabilityRegistry;
}

export function buildStack(db: Database = getTestDb()): Stack {
  const engine = new StubFiscalEngine();
  const executors = new ExecutorRegistry();
  executors.register("CUSTOMER_CREATE", customerCreateExecutor);
  executors.register("CUSTOMER_UPDATE", customerUpdateExecutor);
  executors.register("INVENTORY_ADJUSTMENT", inventoryAdjustmentExecutor);
  executors.register("PRICE_UPDATE", priceUpdateExecutor);
  for (const kind of ["INVOICE_CREATE", "GLOBAL_INVOICE_CREATE", "CREDIT_NOTE_CREATE"] as const) {
    executors.register(kind, invoiceStampExecutor({ engine }));
  }
  executors.register("INVOICE_CANCELLATION", invoiceCancellationExecutor({ engine }));

  const proposals = new ProposalService(db, executors);
  const customers = new CustomerService(db, proposals);
  const catalog = new CatalogService(db);
  const inventory = new InventoryService(db, proposals);
  const pricing = new PricingService(db, proposals);
  const invoices = new InvoiceService(db, proposals);

  return {
    db,
    proposals,
    customers,
    catalog,
    inventory,
    pricing,
    invoices,
    capabilities: new CapabilityRegistry().registerAll(
      buildCapabilities({ customers, catalog, inventory, pricing, invoices }),
    ),
  };
}

export function agentWith(stack: Stack, turns: FakeTurn[]): { agent: AgentService; provider: FakeProvider } {
  const provider = new FakeProvider(turns);
  return { agent: new AgentService(stack.db, stack.capabilities, provider), provider };
}

export async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

export function toolResults(events: AgentEvent[]): Extract<AgentEvent, { type: "tool_result" }>[] {
  return events.filter((event): event is Extract<AgentEvent, { type: "tool_result" }> => event.type === "tool_result");
}

export interface Company {
  actor: ActorContext;
  customerId: string;
  productId: string;
  warehouseId: string;
}

/**
 * One tenant with everything the evals need: a fiscal profile, an invoiceable
 * customer, the spec's Figure Dragon XL cost model, and stock on hand.
 */
export async function seedCompany(
  stack: Stack,
  options: { name?: string; role?: MembershipRole; stock?: string; salePrice?: string; customerName?: string } = {},
): Promise<Company> {
  const tenant = await seedTenant(stack.db, { tenantName: options.name ?? "Maicora Demo" });
  const role = options.role ?? "OWNER";
  const actor: ActorContext = { ...tenant, roles: [role], permissions: permissionsForRole(role) };

  await stack.db.insert(schema.fiscalSettings).values({
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

  const customerId = newId();
  await stack.db.insert(schema.customers).values({
    id: customerId,
    tenantId: tenant.tenantId,
    displayName: options.customerName ?? "ACME SA de CV",
    legalName: options.customerName ?? "ACME SA DE CV",
    rfc: "TNO950101AB1",
    taxRegime: "601",
    fiscalPostalCode: "64000",
    email: "pagos@acme.mx",
  });

  const productId = newId();
  await stack.db.insert(schema.products).values({
    id: productId,
    tenantId: tenant.tenantId,
    sku: "DRAGON-XL",
    name: "Figure Dragon XL",
    salePrice: options.salePrice ?? "230.00",
    satProductCode: "01010101",
    satUnitCode: "H87",
  });

  // The spec's worked example: components summing to a true cost of 181.40
  // (docs/mvp/09-proposals-and-governance.md).
  await stack.pricing.createCostModel(actor, {
    productId,
    pattern: "MANUFACTURED",
    components: [
      { type: "MATERIAL", label: "Resin", amount: "96.00" },
      { type: "LABOR", label: "Finishing", amount: "42.40" },
      { type: "PACKAGING", label: "Box", amount: "18.00" },
      { type: "FIXED_OVERHEAD", label: "Studio overhead", amount: "25.00" },
    ],
  });

  const warehouse = await stack.inventory.createWarehouse(actor, { name: "Main", code: "MAIN", isDefault: true });
  await setStock(stack, actor, productId, options.stock ?? "40");

  return { actor, customerId, productId, warehouseId: warehouse.id };
}

/** Stock arrives the only way it can: through an approved, executed proposal. */
export async function setStock(stack: Stack, actor: ActorContext, productId: string, quantity: string): Promise<void> {
  const proposal = await stack.inventory.prepareAdjustment(actor, {
    productId,
    countedQuantity: quantity,
    reason: "Opening count",
    idempotencyKey: `seed-stock-${productId}-${quantity}`,
  });
  await stack.proposals.approve(actor, proposal.id);
  await stack.proposals.execute(actor, proposal.id);
}

export async function reset(db: Database = getTestDb()): Promise<void> {
  await truncateAll(db);
}
