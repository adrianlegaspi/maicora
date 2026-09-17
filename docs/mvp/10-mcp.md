# 10. MCP Exposure

> Part of the [Maicora MVP Specification](./index.md).

---

MCP remains included because it is part of Maicora’s product thesis.

Initial tools:

```text
customers.search
customers.get

products.search
products.get

inventory.get_stock
inventory.get_movements

pricing.calculate_true_cost
pricing.calculate_target_price

invoices.search
invoices.get
invoices.prepare_invoice
```

Critical writes still use Maicora approval/proposal logic.

External agents cannot self-approve fiscal operations.
