# 7. Invoicing / CFDI

> Part of the [Maicora MVP Specification](./index.md).

---

## MVP Fiscal Scope

Include:

- CFDI 4.0 ingreso
- CFDI egreso / credit note where required for corrections
- CFDI cancellation
- Factura global
- Público en general
- SAT catalogs
- CSD setup
- PAC configuration
- Sandbox mode
- Production mode
- XML persistence
- PDF representation
- Fiscal status

**Payment complements are deferred** because receivables/payments are excluded from this trimmed MVP.

---

## Invoice Creation

Invoice may be created:

- Manually
- Through agent proposal
- Through MCP proposal

Minimum data:

- Customer or público general
- Items
- Quantity
- Unit price
- Discounts
- Taxes
- Currency
- Payment form
- Payment method
- CFDI use
- Place of issuance
- Fiscal relationships where needed

---

## Inventory Interaction

For inventory-tracked items:

- Invoice proposal shows stock impact.
- Approved invoice may deduct stock according to configured workflow.
- Negative stock follows deterministic tenant policy.
- Cancellation/reversal uses compensating inventory logic.

---

## Fiscal Engine

```text
Node.js CFDI Domain
        ↓
Fiscal Engine Client
        ↓
Python Fiscal Service
        ↓
python-satcfdi
        ↓
Configured PAC
        ↓
SAT
```

Python does fiscal mechanics.

Node remains authoritative for:

- Authorization
- Tenant context
- Invoice state
- Proposal lifecycle
- Audit
- Persistence
- Idempotency
