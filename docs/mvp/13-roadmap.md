# 13. Development Phases and Definition of Done

> Part of the [Maicora MVP Specification](./index.md).

---

## Development Phases

### Phase 0 — Platform

- Monorepo
- Docker
- Web/API
- Supabase/PostgreSQL
- Drizzle
- Auth
- Tenants
- Membership
- Permissions
- Basic UI shell
- Agent streaming skeleton
- Capability registry
- Audit primitives

### Phase 1 — Customers + Products

- Customers
- Fiscal profiles
- Products/services
- SAT fields
- Search
- Lists/forms
- CSV imports

### Phase 2 — Pricing

- Cost models
- Cost components
- Cost versions
- Pricing calculator
- Scenario tool
- Agent pricing capabilities

### Phase 3 — Inventory

- Warehouses
- Stock ledger
- Opening balance
- Adjustments
- Stock views
- Agent inventory capabilities

### Phase 4 — Proposal / ChangeSet System

- Proposal persistence
- Diff
- Approval
- Execution
- ChangeSets
- Revert framework
- Agent integration

### Phase 5 — Invoicing / CFDI

- Invoice domain
- Fiscal settings
- Python fiscal engine
- `python-satcfdi`
- PAC sandbox
- CFDI ingreso
- Egreso/correction
- Factura global
- Cancellation
- XML/PDF persistence
- Inventory interaction

### Phase 6 — MCP

- MCP gateway
- Auth
- Tool mapping
- Read tools
- Draft invoice tool
- Permission enforcement

### Phase 7 — Hardening

- Agent evals
- Tenant isolation tests
- Fiscal idempotency tests
- Prompt injection tests
- Docker self-host docs
- Demo tenant
- Public alpha polish

---

## Definition of Done

The trimmed MVP is ready when a real user can:

1. Create an account.
2. Create or join multiple companies.
3. Switch tenants safely.
4. Create/import customers.
5. Create/import products/services.
6. Configure realistic cost models.
7. Ask Maicora how much a product should cost/sell for.
8. Track stock through a deterministic inventory ledger.
9. Correct stock through an approval-gated agent proposal.
10. Create invoice drafts manually or through the agent.
11. Review a Business Diff before fiscal execution.
12. Stamp CFDI in sandbox.
13. Configure production fiscal environment.
14. Persist XML/PDF and fiscal status.
15. Create factura global.
16. Cancel/correct CFDIs through valid fiscal workflows.
17. Inspect audit and ChangeSet history.
18. Revert reversible agent changes.
19. Connect an external MCP client.
20. Change AI provider through the OpenAI-compatible API configuration.
