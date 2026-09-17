# 4. Core Domains — Tenancy, Customers, Catalog

> Part of the [Maicora MVP Specification](./index.md).

---

## Tenancy

Entities:

- Tenant
- TenantMembership
- Branch
- User
- Role
- Permission

Rules:

- A user may belong to multiple tenants.
- Active tenant is explicit.
- All business entities are tenant-scoped.
- Branch scope exists from day one even if most MVP tenants only use one branch.

---

## Customers

Support:

- Create
- Edit
- Archive
- Search
- List/detail
- Fiscal profile
- Contacts
- Addresses
- Notes
- Tags
- Invoice history
- Público en general

Minimum fiscal data:

- RFC
- Legal/fiscal name
- Fiscal postal code
- Tax regime
- CFDI usage defaults where relevant
- Email
- Fiscal address metadata as needed

The agent must detect missing fiscal data before invoice preparation.

---

## Products and Services

Minimum model:

- SKU
- Name
- Description
- PRODUCT / SERVICE
- Active status
- Sale price
- Currency
- Tax configuration
- SAT product/service code
- Internal unit
- SAT unit code
- Inventory tracking toggle
- Current estimated cost
- Pricing/costing configuration

Services remain valid invoice items even when inventory tracking is disabled.
