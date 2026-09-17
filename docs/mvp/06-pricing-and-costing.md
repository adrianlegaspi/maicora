# 6. Pro Pricing / Costing

> Part of the [Maicora MVP Specification](./index.md).

---

This remains a first-class MVP feature.

## Costing Patterns

### Resale

```text
Purchase cost
+ freight
+ handling
+ fees
+ allocated overhead
= true estimated unit cost
```

### Manufactured item

```text
Materials
+ machine/equipment allocation
+ energy
+ labor
+ waste
+ packaging
+ logistics
+ fees
+ overhead
= true estimated unit cost
```

### Service

```text
Labor/time
+ direct expenses
+ equipment/tool allocation
+ travel/logistics
+ fees
+ overhead
= true estimated service cost
```

---

## Cost Component Types

```text
MATERIAL
PURCHASE_COST
MACHINE_TIME
EQUIPMENT_ALLOCATION
ENERGY
LABOR
PACKAGING
FREIGHT
DELIVERY
WASTE
TRANSACTION_FEE
MARKETPLACE_FEE
FIXED_OVERHEAD
VARIABLE_OVERHEAD
OTHER
```

---

## Pricing Outputs

Must calculate:

- True estimated cost
- Break-even price
- Markup
- Gross margin
- Target margin price
- Current sale price margin
- Profit per unit
- Scenario comparison

---

## Versioning

Cost models are versioned.

Historical cost assumptions remain inspectable.

The LLM never performs authoritative pricing math. It calls deterministic pricing capabilities and explains their outputs.
