# 5. Inventory

> Part of the [Maicora MVP Specification](./index.md).

---

## Scope

Support:

- Warehouses
- Stock on hand
- Stock adjustments
- Stock movement history
- Manual opening stock
- Inventory deduction from invoice where configured
- Inventory restoration through valid compensating workflows
- Low-stock indicator
- Basic inventory filters/search

Deferred:

- Reservations
- Transfers
- Purchase receipts
- Lots
- Serials
- Expiration
- Advanced replenishment

---

## Inventory Ledger

All stock mutations go through a ledger.

Initial movement types:

```text
OPENING_BALANCE
MANUAL_ADJUSTMENT
INVOICE_OUT
INVOICE_REVERSAL
```

Each movement records:

- Tenant
- Product
- Warehouse
- Quantity
- Direction
- Source
- Actor
- ChangeSet
- Timestamp
- Optional reason

Never directly mutate stock without a ledger entry.
