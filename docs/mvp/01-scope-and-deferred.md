# 1. Scope and Deferred Modules

> Part of the [Maicora MVP Specification](./index.md).

---

## MVP Goal

Build the smallest version of Maicora that proves the core thesis:

> **An agent-first business system can safely understand company data, perform useful cross-module work, show proposed changes, execute approved operations, and remain auditable and reversible where possible.**

The MVP includes only:

- Customers
- Products + Inventory
- Invoices / CFDI
- Pro Pricing / Costing
- Agent interface
- Business Proposals / Diff
- Audit / ChangeSets
- MCP exposure
- Multi-tenancy
- Authentication / permissions

Everything else from the master PRD remains architecturally valid but is deferred.

---

## Explicitly Deferred

Not part of this MVP:

- Quotes
- Sales orders
- Purchasing
- Suppliers
- Purchase orders
- Replenishment
- Receivables
- Accounts payable
- Payment allocation
- Payment complements
- CRM pipeline
- Marketing automation
- POS
- Full accounting
- Payroll
- HR
- Manufacturing planning
- Banking
- E-commerce
- Advanced reporting

The architecture must not intentionally block these future modules.

---

## Core MVP Loop

```text
Customer / Público general
        ↓
Products / Services
        ↓
Costing / Pro Pricing
        ↓
Inventory
        ↓
Invoice Draft
        ↓
Business Proposal / Diff
        ↓
Approval
        ↓
CFDI Validation + Stamp
        ↓
Audit / ChangeSet
```
