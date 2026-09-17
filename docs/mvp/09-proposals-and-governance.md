# 9. Proposals, Risk Model, and ChangeSets

> Part of the [Maicora MVP Specification](./index.md).

---

## Business Proposal / Diff

Keep the full Maicora proposal architecture.

Example invoice proposal:

```text
Invoice ACME SA de CV

+ 10 × SKU-123
+ 4 × SKU-456

Subtotal: MXN 8,400
IVA:      MXN 1,344
Total:    MXN 9,744

Inventory impact:
SKU-123: 54 → 44
SKU-456: 18 → 14

Fiscal action:
CFDI 4.0 Ingreso
Environment: Sandbox

Requires approval: YES
```

Example pricing proposal:

```text
Product: Figure Dragon XL

Current estimated cost: MXN 181.40
Current sale price:      MXN 230.00
Current margin:          21.1%

Target margin:           35%
Recommended price:       MXN 279.08

~ Sale price: MXN 230.00 → MXN 279.08
```

---

## Risk Model

### Automatic

- Read customers
- Read products
- Read invoices
- Read stock
- Read pricing
- Analyze margin
- Calculate prices

### Draft automatically

- Customer changes
- Price changes
- Invoice drafts
- Global invoice drafts
- Credit-note drafts
- Inventory adjustment drafts

### Approval required

- Stamp CFDI
- Cancel CFDI
- Apply inventory adjustment
- Change product sale price through agent
- Execute bulk customer changes
- Any destructive action

---

## ChangeSets and Undo

Keep the full revision architecture.

### Reversible

- Customer edits
- Product edits
- Price changes
- Internal metadata

### Compensatable

- Inventory adjustments
- Invoice-linked inventory movements
- Fiscal corrections

Stamped/cancelled CFDIs are never “undone” by rewriting history.

Use legal compensating actions.
