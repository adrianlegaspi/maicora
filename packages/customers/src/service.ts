import type { ActorContext } from "@maicora/shared";
import { NotFoundError, ValidationError } from "@maicora/shared";
import type { Database } from "@maicora/database";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { BusinessDiff, Executor, ProposalRecord, ProposalService, Reverter } from "@maicora/proposals";
import { CustomerRepository, type CustomerRow } from "./repository.js";
import { checkFiscalReadiness } from "./fiscal.js";
import type { CustomerInput, CustomerPatch, CustomerSearchParams, FiscalReadiness } from "./types.js";

/** Field labels shared by the create and update diffs, in the spec's order. */
const DIFF_FIELDS: { key: keyof CustomerInput; label: string }[] = [
  { key: "displayName", label: "Name" },
  { key: "legalName", label: "Legal/fiscal name" },
  { key: "rfc", label: "RFC" },
  { key: "taxRegime", label: "Tax regime" },
  { key: "fiscalPostalCode", label: "Fiscal postal code" },
  { key: "cfdiUseDefault", label: "CFDI use default" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "tags", label: "Tags" },
];

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "not set";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export class CustomerService {
  constructor(
    private readonly db: Database,
    private readonly proposals: ProposalService,
  ) {}

  async search(actor: ActorContext, params: CustomerSearchParams = {}): Promise<CustomerRow[]> {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_READ);
    return new CustomerRepository(this.db).search(actor, params);
  }

  async get(actor: ActorContext, customerId: string): Promise<CustomerRow> {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_READ);
    const customer = await new CustomerRepository(this.db).get(actor, customerId);
    if (!customer) throw new NotFoundError("Customer", customerId);
    return customer;
  }

  async getInvoiceHistory(actor: ActorContext, customerId: string, limit?: number) {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_READ);
    assertPermission(actor, PERMISSIONS.INVOICES_READ);
    const repo = new CustomerRepository(this.db);
    if (!(await repo.get(actor, customerId))) throw new NotFoundError("Customer", customerId);
    return repo.listInvoices(actor, customerId, limit);
  }

  /** The check an invoice draft must pass before a CFDI can be prepared. */
  async getFiscalReadiness(actor: ActorContext, customerId: string): Promise<FiscalReadiness> {
    return checkFiscalReadiness(await this.get(actor, customerId));
  }

  /**
   * Backs the "Find customers missing fiscal information" flow in
   * docs/mvp/08-agent.md: a deterministic scan the agent only narrates.
   */
  async findCustomersMissingFiscalData(actor: ActorContext, limit = 500): Promise<FiscalReadiness[]> {
    const customers = await this.search(actor, { limit });
    return customers.map(checkFiscalReadiness).filter((r) => !r.ready);
  }

  /** Archiving hides a customer without deleting invoice history, so it applies directly. */
  async archive(actor: ActorContext, customerId: string, isArchived = true): Promise<void> {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_WRITE);
    const repo = new CustomerRepository(this.db);
    if (!(await repo.get(actor, customerId))) throw new NotFoundError("Customer", customerId);
    await repo.setArchived(actor, customerId, isArchived, actor.userId);
  }

  async prepareCreate(
    actor: ActorContext,
    input: CustomerInput,
    options: { idempotencyKey: string; requestedByAgent?: boolean },
  ): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_WRITE);
    if (!input.displayName?.trim()) {
      throw new ValidationError("A customer needs a display name", { field: "displayName" });
    }

    return this.proposals.create(actor, {
      kind: "CUSTOMER_CREATE",
      payload: { input: { ...input, displayName: input.displayName.trim() } },
      diff: customerCreateDiff(input),
      requestedBy: actor.userId,
      requestedByAgent: options.requestedByAgent ?? false,
      idempotencyKey: options.idempotencyKey,
    });
  }

  async prepareUpdate(
    actor: ActorContext,
    customerId: string,
    patch: CustomerPatch,
    options: { idempotencyKey: string; requestedByAgent?: boolean },
  ): Promise<ProposalRecord> {
    assertPermission(actor, PERMISSIONS.CUSTOMERS_WRITE);
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("A customer update needs at least one field", { customerId });
    }
    const current = await this.get(actor, customerId);

    return this.proposals.create(actor, {
      kind: "CUSTOMER_UPDATE",
      payload: { customerId, patch },
      diff: customerUpdateDiff(current, patch),
      requestedBy: actor.userId,
      requestedByAgent: options.requestedByAgent ?? false,
      idempotencyKey: options.idempotencyKey,
    });
  }
}

/** One line stating whether the customer can be invoiced, appended to both diffs. */
function fiscalSection(customer: Parameters<typeof checkFiscalReadiness>[0]): BusinessDiff["sections"] {
  const readiness = checkFiscalReadiness(customer);
  return readiness.ready
    ? [{ lines: ["Fiscal data: complete, ready to invoice"] }]
    : [{ lines: [`Fiscal data: incomplete, missing ${readiness.missing.join(", ")}`] }];
}

export function customerCreateDiff(input: CustomerInput): BusinessDiff {
  return {
    title: `New customer: ${input.displayName}`,
    sections: [
      {
        changes: DIFF_FIELDS.filter((f) => input[f.key] !== undefined).map((f) => ({
          label: f.label,
          before: "not set",
          after: display(input[f.key]),
        })),
      },
      ...fiscalSection({
        id: "",
        displayName: input.displayName,
        kind: input.kind ?? "BUSINESS",
        rfc: input.rfc ?? null,
        legalName: input.legalName ?? null,
        fiscalPostalCode: input.fiscalPostalCode ?? null,
        taxRegime: input.taxRegime ?? null,
        email: input.email ?? null,
      }),
    ],
  };
}

export function customerUpdateDiff(current: CustomerRow, patch: CustomerPatch): BusinessDiff {
  const changes = DIFF_FIELDS.filter((f) => patch[f.key] !== undefined)
    .map((f) => ({
      label: f.label,
      before: display(current[f.key as keyof CustomerRow]),
      after: display(patch[f.key]),
    }))
    .filter((c) => c.before !== c.after);

  return {
    title: `Customer: ${current.displayName}`,
    sections: [{ changes }, ...fiscalSection({ ...current, ...patch })],
  };
}

/**
 * Applies an approved CUSTOMER_CREATE. Runs inside the ProposalService's
 * transaction so the insert and its ChangeSet commit together. Register with
 * `registry.register("CUSTOMER_CREATE", customerCreateExecutor)`.
 */
export const customerCreateExecutor: Executor = async ({ tx, actor, payload }) => {
  const input = payload.input as CustomerInput;
  const customer = await new CustomerRepository(tx).insert(actor, input, actor.userId);

  return {
    entityType: "customer",
    entityId: customer.id,
    action: "CREATE",
    before: null,
    after: { ...input },
    // Reversible by archiving: no fiscal document has been issued yet.
    reversible: true,
    result: { customerId: customer.id, displayName: customer.displayName },
  };
};

/** Applies an approved CUSTOMER_UPDATE, recording only the fields it touched. */
export const customerUpdateExecutor: Executor = async ({ tx, actor, payload }) => {
  const customerId = String(payload.customerId);
  const patch = payload.patch as CustomerPatch;

  const repo = new CustomerRepository(tx);
  const current = await repo.get(actor, customerId);
  if (!current) throw new NotFoundError("Customer", customerId);

  const before = Object.fromEntries(
    Object.keys(patch).map((key) => [key, current[key as keyof CustomerRow] ?? null]),
  );
  await repo.update(actor, customerId, patch, actor.userId);

  return {
    entityType: "customer",
    entityId: customerId,
    action: "UPDATE",
    before,
    after: { ...patch },
    reversible: true,
    result: { customerId },
  };
};

/**
 * Undoes an applied customer ChangeSet. A create is undone by archiving
 * rather than deleting: the row may already be referenced elsewhere, and
 * deleting it would take that history with it. An update is undone by
 * writing back the fields the ChangeSet recorded.
 */
export const customerReverter: Reverter = async ({ tx, actor, changeset }) => {
  const repo = new CustomerRepository(tx);
  const customer = await repo.get(actor, changeset.entityId);
  if (!customer) throw new NotFoundError("Customer", changeset.entityId);

  if (changeset.action === "CREATE") {
    await repo.setArchived(actor, changeset.entityId, true, actor.userId);
    return {
      entityType: "customer",
      entityId: changeset.entityId,
      action: "REVERT",
      before: { isArchived: customer.isArchived },
      after: { isArchived: true },
      reversible: false,
      result: { customerId: changeset.entityId, archived: true },
    };
  }

  const patch = (changeset.before ?? {}) as CustomerPatch;
  await repo.update(actor, changeset.entityId, patch, actor.userId);
  return {
    entityType: "customer",
    entityId: changeset.entityId,
    action: "REVERT",
    before: changeset.after,
    after: { ...patch },
    reversible: false,
    result: { customerId: changeset.entityId },
  };
};
