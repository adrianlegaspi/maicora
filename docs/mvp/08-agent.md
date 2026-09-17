# 8. Agent Workspace, Capabilities, Flows, and Memory

> Part of the [Maicora MVP Specification](./index.md).

---

## Agent Workspace

The MVP remains agent-first.

```text
┌──────────────────────────────────────────────────────────┐
│ Tenant / Branch / Global Search                         │
├──────────────┬───────────────────────────────────────────┤
│ Customers    │                                           │
│ Products     │             Workspace                     │
│ Inventory    │                                           │
│ Invoices     │     Agent / Tables / Forms / Diff         │
│ Pricing      │                                           │
│ Settings     │                                           │
├──────────────┴───────────────────────────────────────────┤
│ Persistent Agent Composer                               │
└──────────────────────────────────────────────────────────┘
```

One master agent.

No visible specialist agents.

---

## MVP Agent Capabilities

Keep the capability set deliberately small and excellent.

### Read / Analyze

```text
customers.search
customers.get
customers.get_invoice_history

products.search
products.get

inventory.get_stock
inventory.get_movements
inventory.find_low_stock

pricing.calculate_true_cost
pricing.calculate_target_price
pricing.compare_scenarios

invoices.search
invoices.get
invoices.explain
```

### Draft / Proposal

```text
customers.prepare_create
customers.prepare_update

inventory.prepare_adjustment

pricing.prepare_price_update

invoices.prepare_invoice
invoices.prepare_global_invoice
invoices.prepare_credit_note
invoices.prepare_cancellation
```

Critical execution happens only through approved proposal workflows where required.

---

## Killer MVP Agent Flows

### Create Invoice

User:

> “Invoice ACME for 10 units of SKU-123 and 4 units of SKU-456.”

Agent:

1. Finds ACME.
2. Validates fiscal profile.
3. Finds products.
4. Checks stock.
5. Calculates taxes.
6. Builds invoice draft.
7. Shows inventory impact.
8. Shows Business Diff.
9. Requests approval.
10. Stamps in configured environment.
11. Applies inventory movement if configured.
12. Stores XML/PDF.
13. Creates audit/ChangeSet.

### Pro Pricing

User:

> “How much should I sell this 3D printed figure for if I want a 35% margin?”

Agent:

1. Reads product cost model.
2. Runs deterministic cost calculation.
3. Calculates required sale price.
4. Explains major cost contributors.
5. Optionally prepares a price-change proposal.

### Inventory Correction

User:

> “We counted 47 units of SKU-991 but Maicora says 52. Fix it.”

Agent:

1. Reads current stock.
2. Calculates adjustment.
3. Requires reason.
4. Creates adjustment proposal.
5. Shows Business Diff.
6. Requests approval.
7. Posts ledger movement.
8. Records ChangeSet.

### Factura Global

User:

> “Prepare today’s público general invoice.”

Agent:

1. Identifies eligible general-public invoice data.
2. Applies deterministic fiscal grouping rules.
3. Prepares factura global draft.
4. Shows proposal.
5. Requires fiscal approval.
6. Stamps through fiscal engine.

For the trimmed MVP, general-public transaction data may initially be manually entered or imported rather than coming from a full POS.

### Fiscal Readiness

User:

> “Find customers missing fiscal information required to invoice them.”

Agent:

1. Scans authorized customer records.
2. Uses deterministic validation.
3. Lists missing fields.
4. Links to affected customers.

---

## AI Memory

Keep memory, but scope it conservatively.

Useful examples:

- Preferred warehouse
- Company terminology
- Pricing preferences
- Typical target margin
- Fiscal workflow preferences
- User display preferences

Do not store authoritative business facts in memory.

Inventory, invoices, customers, prices, and fiscal state come from domain records.
