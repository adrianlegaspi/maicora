# Maicora MVP Specification

> **Status:** Implementation scope for first MVP  
> **Parent:** `MAICORA_MASTER_PRD.md`  
> **Date:** 2026-09-17  
> **Rule:** Preserve Maicora architecture, security, UX, agent model, and technical foundation. Trim only business modules and capabilities.

This file is the index. The specification itself lives in the numbered chapter
files alongside it — read them in order for the full spec, or jump straight to
the chapter you need.

---

## Chapters

| # | Chapter | Covers |
|---|---------|--------|
| 1 | [Scope and Deferred Modules](./01-scope-and-deferred.md) | MVP goal and thesis, what's in, what's explicitly deferred, the core MVP loop |
| 2 | [Platform Foundation](./02-platform-foundation.md) | Stack and platform pieces kept despite the smaller scope, AI provider configuration |
| 3 | [Backend Architecture and Repository Layout](./03-architecture.md) | Request/layer architecture, fiscal path, suggested monorepo structure |
| 4 | [Core Domains — Tenancy, Customers, Catalog](./04-core-domains.md) | Tenancy and membership rules, customer model and fiscal data, products/services model |
| 5 | [Inventory](./05-inventory.md) | Inventory scope and deferrals, the inventory ledger and movement types |
| 6 | [Pro Pricing / Costing](./06-pricing-and-costing.md) | Costing patterns, cost component types, pricing outputs, cost-model versioning |
| 7 | [Invoicing / CFDI](./07-invoicing-cfdi.md) | Fiscal scope, invoice creation, inventory interaction, Node/Python fiscal engine split |
| 8 | [Agent Workspace, Capabilities, Flows, and Memory](./08-agent.md) | Workspace layout, the MVP capability set, the killer agent flows, AI memory scope |
| 9 | [Proposals, Risk Model, and ChangeSets](./09-proposals-and-governance.md) | Business Proposal/Diff examples, what's automatic vs approval-gated, undo and compensation |
| 10 | [MCP Exposure](./10-mcp.md) | Initial MCP tool surface and approval boundaries for external agents |
| 11 | [Primary Screens and Imports](./11-screens-and-imports.md) | Minimum screen list, CSV imports |
| 12 | [Agent Evaluations](./12-agent-evaluations.md) | Golden evals: tenant isolation, pricing math, fiscal approval, prompt injection, idempotency |
| 13 | [Development Phases and Definition of Done](./13-roadmap.md) | Phase 0–7 build order and the user-facing completion checklist |
| 14 | [Non-negotiables and Final MVP Thesis](./14-non-negotiables-and-thesis.md) | The hard architectural rules and what the MVP must ultimately prove |

---

## Reading paths

- **New to the project:** 1 → 2 → 3, then 14.
- **Building a domain module:** 4 → 5 / 6 / 7 for the relevant domain, plus 9.
- **Working on the agent:** 8 → 9 → 12.
- **Planning or sequencing work:** 1 → 13.
- **Before any architectural decision:** 14.
