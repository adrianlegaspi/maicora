import { createDatabase, type Database } from "@maicora/database";
import { AuthService, type JwtConfig } from "@maicora/auth";
import { AuditService } from "@maicora/audit";
import { MemoryService } from "@maicora/memory";
import { AgentService, FakeProvider, OpenAICompatibleProvider, type ChatProvider } from "@maicora/agent";
import { buildCapabilities, CapabilityRegistry } from "@maicora/capabilities";
import {
  CustomerService,
  customerCreateExecutor,
  customerReverter,
  customerUpdateExecutor,
} from "@maicora/customers";
import { CatalogService } from "@maicora/catalog";
import { InventoryService, inventoryAdjustmentExecutor } from "@maicora/inventory";
import { PricingService, priceUpdateExecutor, priceUpdateReverter } from "@maicora/pricing";
import {
  FiscalSettingsService,
  InvoiceService,
  invoiceCancellationExecutor,
  invoiceStampExecutor,
} from "@maicora/invoices";
import { ExecutorRegistry, ProposalService } from "@maicora/proposals";
import { FiscalEngineClient, StubFiscalEngine, type FiscalEngine } from "@maicora/cfdi";
import { ImportService, bulkImportExecutor } from "@maicora/imports";
import { loadConfig, type Config } from "./config.js";

export interface Container {
  config: Config;
  db: Database;
  jwt: JwtConfig;
  auth: AuthService;
  audit: AuditService;
  memory: MemoryService;
  agent: AgentService;
  capabilities: CapabilityRegistry;
  proposals: ProposalService;
  customers: CustomerService;
  catalog: CatalogService;
  inventory: InventoryService;
  pricing: PricingService;
  invoices: InvoiceService;
  fiscalSettings: FiscalSettingsService;
  imports: ImportService;
}

/**
 * The single place the application is wired together. Every executor is
 * registered here, so a proposal kind that nobody can execute fails loudly at
 * approval time rather than silently doing nothing.
 */
export function buildContainer(config: Config = loadConfig()): Container {
  const db = createDatabase(config.databaseUrl);
  const engine = fiscalEngine(config);

  const executors = new ExecutorRegistry();
  executors.register("CUSTOMER_CREATE", customerCreateExecutor);
  executors.register("CUSTOMER_UPDATE", customerUpdateExecutor);
  executors.register("INVENTORY_ADJUSTMENT", inventoryAdjustmentExecutor);
  executors.register("PRICE_UPDATE", priceUpdateExecutor);
  for (const kind of ["INVOICE_CREATE", "GLOBAL_INVOICE_CREATE", "CREDIT_NOTE_CREATE"] as const) {
    executors.register(kind, invoiceStampExecutor({ engine, environment: config.fiscalEnvironment }));
  }
  executors.register(
    "INVOICE_CANCELLATION",
    invoiceCancellationExecutor({ engine, environment: config.fiscalEnvironment }),
  );
  executors.register("BULK_IMPORT", bulkImportExecutor);

  // Only the two entity types docs/mvp/09-proposals-and-governance.md
  // calls reversible. Everything else is compensated, not undone.
  executors.registerReverter("customer", customerReverter);
  executors.registerReverter("product", priceUpdateReverter);

  const proposals = new ProposalService(db, executors);
  const customers = new CustomerService(db, proposals);
  const catalog = new CatalogService(db);
  const inventory = new InventoryService(db, proposals);
  const pricing = new PricingService(db, proposals);
  const invoices = new InvoiceService(db, proposals, { environment: config.fiscalEnvironment });

  const capabilities = new CapabilityRegistry().registerAll(
    buildCapabilities({ customers, catalog, inventory, pricing, invoices }),
  );

  return {
    config,
    db,
    jwt: config.jwt,
    auth: new AuthService(db),
    audit: new AuditService(db),
    memory: new MemoryService(db),
    agent: new AgentService(db, capabilities, chatProvider(config)),
    capabilities,
    proposals,
    customers,
    catalog,
    inventory,
    pricing,
    invoices,
    fiscalSettings: new FiscalSettingsService(db),
    imports: new ImportService(db, proposals),
  };
}

function fiscalEngine(config: Config): FiscalEngine {
  // Without a fiscal engine URL there is nothing to stamp against. The stub
  // keeps local development and tests working; it never pretends to be a PAC.
  if (!config.fiscalEngineUrl) return new StubFiscalEngine();
  return new FiscalEngineClient({
    baseUrl: config.fiscalEngineUrl,
    apiKey: config.fiscalEngineSecret,
  });
}

function chatProvider(config: Config): ChatProvider {
  if (!config.ai) {
    // ponytail: a single canned reply, so the app runs end to end without an
    // API key. Set AI_API/AI_API_KEY/AI_MODEL for a real model.
    return new FakeProvider([
      { text: "No AI provider is configured. Set AI_API, AI_API_KEY and AI_MODEL to enable the agent." },
    ]);
  }
  return new OpenAICompatibleProvider(config.ai);
}
