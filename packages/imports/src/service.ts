import { Decimal } from "decimal.js";
import type { Database } from "@maicora/database";
import { ValidationError, type ActorContext } from "@maicora/shared";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { BusinessDiff, Executor, ProposalRecord } from "@maicora/proposals";
import { ProposalService } from "@maicora/proposals";
import { CustomerRepository } from "@maicora/customers";
import { CatalogRepository } from "@maicora/catalog";
import { InventoryRepository } from "@maicora/inventory";
import { parseCsvRecords } from "./csv.js";

export type ImportKind = "CUSTOMERS" | "PRODUCTS" | "OPENING_STOCK";

export interface PrepareImportInput {
  kind: ImportKind;
  csv: string;
  /** Opening stock only; falls back to the default warehouse. */
  warehouseId?: string;
  idempotencyKey: string;
  requestedByAgent?: boolean;
}

export interface ImportRowError {
  /** 1-based data row, matching what the spreadsheet shows minus the header. */
  row: number;
  message: string;
}

interface ParsedImport {
  kind: ImportKind;
  rows: Record<string, string>[];
  errors: ImportRowError[];
  warehouseId?: string;
}

const REQUIRED_COLUMNS: Record<ImportKind, string[]> = {
  CUSTOMERS: ["display_name"],
  PRODUCTS: ["sku", "name"],
  OPENING_STOCK: ["sku", "quantity"],
};

/**
 * The three MVP imports (docs/mvp/11-screens-and-imports.md). All three take
 * the same path: parse, validate every row, show what would happen, and let a
 * human approve it. The spec puts "bulk customer changes" on the
 * approval-required list, and an import is the largest bulk change there is.
 */
export class ImportService {
  constructor(
    private readonly db: Database,
    private readonly proposals: ProposalService,
  ) {}

  async prepare(actor: ActorContext, input: PrepareImportInput): Promise<ProposalRecord> {
    assertPermission(actor, permissionFor(input.kind));

    const parsed = await this.parse(actor, input);
    if (!parsed.rows.length) {
      throw new ValidationError("The file has no data rows", { kind: input.kind });
    }
    if (parsed.errors.length) {
      // Refusing the whole file is the honest option: a half-applied import
      // leaves the user reconciling by hand, which is worse than fixing a CSV.
      throw new ValidationError(`${parsed.errors.length} row(s) cannot be imported`, {
        errors: parsed.errors.slice(0, 20),
      });
    }

    return this.proposals.create(actor, {
      kind: "BULK_IMPORT",
      payload: { kind: parsed.kind, rows: parsed.rows, warehouseId: parsed.warehouseId },
      diff: importDiff(parsed),
      requestedBy: actor.userId,
      requestedByAgent: input.requestedByAgent ?? false,
      idempotencyKey: input.idempotencyKey,
    });
  }

  private async parse(actor: ActorContext, input: PrepareImportInput): Promise<ParsedImport> {
    const rows = parseCsvRecords(input.csv);
    const header = rows[0] ? Object.keys(rows[0]) : [];
    const missing = REQUIRED_COLUMNS[input.kind].filter((column) => !header.includes(column));
    if (missing.length) {
      throw new ValidationError(`Missing column(s): ${missing.join(", ")}`, {
        expected: REQUIRED_COLUMNS[input.kind],
        found: header,
      });
    }

    const errors: ImportRowError[] = [];
    const catalog = new CatalogRepository(this.db);
    const seen = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const at = index + 1;

      if (input.kind === "CUSTOMERS") {
        if (!row.display_name) errors.push({ row: at, message: "display_name is required" });
        continue;
      }

      if (!row.sku) {
        errors.push({ row: at, message: "sku is required" });
        continue;
      }
      if (seen.has(row.sku)) errors.push({ row: at, message: `sku ${row.sku} appears twice in the file` });
      seen.add(row.sku);

      const existing = await catalog.getBySku(actor, row.sku);

      if (input.kind === "PRODUCTS") {
        if (!row.name) errors.push({ row: at, message: "name is required" });
        if (existing) errors.push({ row: at, message: `sku ${row.sku} already exists` });
        if (row.sale_price && !isDecimal(row.sale_price)) {
          errors.push({ row: at, message: `sale_price ${row.sale_price} is not a number` });
        }
        continue;
      }

      if (!existing) errors.push({ row: at, message: `sku ${row.sku} is not in the catalog` });
      if (!isDecimal(row.quantity ?? "") || new Decimal(row.quantity || "x").isNegative()) {
        errors.push({ row: at, message: `quantity ${row.quantity} is not a positive number` });
      }
    }

    let warehouseId = input.warehouseId;
    if (input.kind === "OPENING_STOCK" && !warehouseId) {
      const warehouse = await new InventoryRepository(this.db).getDefaultWarehouse(actor);
      if (!warehouse) throw new ValidationError("This company has no warehouse yet");
      warehouseId = warehouse.id;
    }

    return { kind: input.kind, rows, errors, warehouseId };
  }
}

/** Applies an approved import. One transaction: the whole file lands or none of it does. */
export const bulkImportExecutor: Executor = async ({ tx, actor, payload, changesetId }) => {
  const { kind, rows, warehouseId } = payload as {
    kind: ImportKind;
    rows: Record<string, string>[];
    warehouseId?: string;
  };

  if (kind === "CUSTOMERS") {
    const repo = new CustomerRepository(tx);
    for (const row of rows) {
      await repo.insert(
        actor,
        {
          displayName: row.display_name ?? "",
          legalName: row.legal_name || null,
          rfc: row.rfc || null,
          taxRegime: row.tax_regime || null,
          fiscalPostalCode: row.fiscal_postal_code || null,
          cfdiUseDefault: row.cfdi_use || null,
          email: row.email || null,
          phone: row.phone || null,
        },
        actor.userId,
      );
    }
  } else if (kind === "PRODUCTS") {
    const repo = new CatalogRepository(tx);
    for (const row of rows) {
      await repo.insert(actor, {
        sku: row.sku ?? "",
        name: row.name ?? "",
        description: row.description || null,
        internalUnit: row.unit || undefined,
        salePrice: row.sale_price || undefined,
        taxRate: row.tax_rate || undefined,
        satProductCode: row.sat_product_code || null,
        satUnitCode: row.sat_unit_code || null,
        trackInventory: row.track_inventory ? row.track_inventory !== "false" : undefined,
      });
    }
  } else {
    const catalog = new CatalogRepository(tx);
    const inventory = new InventoryRepository(tx);
    for (const row of rows) {
      const product = await catalog.getBySku(actor, row.sku ?? "");
      if (!product) throw new ValidationError(`sku ${row.sku} is not in the catalog`);
      await inventory.recordMovement(actor, {
        warehouseId: warehouseId as string,
        productId: product.id,
        movementType: "OPENING_BALANCE",
        direction: "IN",
        quantity: row.quantity ?? "",
        source: `import:${changesetId}`,
        actorId: actor.userId,
        changesetId,
        reason: "Opening stock import",
      });
    }
  }

  return {
    entityType: "import",
    entityId: changesetId,
    action: "CREATE",
    before: null,
    after: { kind, rows: rows.length },
    reversible: false,
    result: { imported: rows.length },
  };
};

function permissionFor(kind: ImportKind) {
  if (kind === "CUSTOMERS") return PERMISSIONS.CUSTOMERS_WRITE;
  if (kind === "PRODUCTS") return PERMISSIONS.PRODUCTS_WRITE;
  return PERMISSIONS.INVENTORY_ADJUST_PROPOSE;
}

function isDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value ?? "");
}

function importDiff(parsed: ParsedImport): BusinessDiff {
  const label = {
    CUSTOMERS: "customers",
    PRODUCTS: "products",
    OPENING_STOCK: "opening stock rows",
  }[parsed.kind];

  const sample = parsed.rows.slice(0, 10).map((row) => {
    if (parsed.kind === "CUSTOMERS") return `+ ${row.display_name}`;
    if (parsed.kind === "PRODUCTS") return `+ ${row.sku} ${row.name}`;
    return `+ ${row.sku}: ${row.quantity}`;
  });
  if (parsed.rows.length > sample.length) {
    sample.push(`... and ${parsed.rows.length - sample.length} more`);
  }

  return {
    title: `Import ${parsed.rows.length} ${label}`,
    sections: [
      { heading: "Rows", lines: sample },
      { heading: "Requires approval", lines: ["YES"] },
    ],
  };
}
