# 14. Non-negotiables and Final MVP Thesis

> Part of the [Maicora MVP Specification](./index.md).

---

## Non-negotiables

Even for this smaller scope:

1. No frontend → Supabase direct access.
2. No raw database access for the LLM.
3. No provider-specific AI architecture.
4. No PAC-specific domain architecture.
5. No CFDI stamping without deterministic validation.
6. No critical writes without policy/approval.
7. No inventory mutation outside the ledger.
8. No unscoped tenant repositories.
9. No business logic inside MCP handlers.
10. No hidden agent writes without ChangeSets.
11. No pricing math delegated to the LLM.
12. No fake undo of fiscal operations.
13. No temporary architecture intended to be rewritten for the full Maicora product.

---

## Final MVP Thesis

The MVP does not need purchasing, sales orders, accounting, payroll, or POS to prove Maicora.

It only needs to prove that a company can safely say:

> “Create an invoice for ACME for these products.”

> “How much should I sell this product for if I want a 35% margin after all real costs?”

> “Why is this product barely profitable?”

> “We counted 47 units instead of 52. Fix the inventory.”

> “Prepare today’s factura global.”

And Maicora can:

```text
Understand
→ Inspect
→ Calculate
→ Propose
→ Show the Diff
→ Request Approval
→ Execute
→ Verify
→ Audit
→ Revert when valid
```

That is enough to demonstrate the product thesis while keeping the first implementation realistically bounded.
