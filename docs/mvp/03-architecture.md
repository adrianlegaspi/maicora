# 3. Backend Architecture and Repository Layout

> Part of the [Maicora MVP Specification](./index.md).

---

## Backend Architecture

Same as the master:

```text
React Web
   ↓
Node.js / TypeScript API
   ↓
Auth / Tenant / Permission Context
   ↓
Capability / Application Layer
   ├── Customers
   ├── Products
   ├── Inventory
   ├── Pricing
   ├── Invoices / CFDI
   ├── Agent
   ├── Memory
   ├── Proposals
   ├── Approvals
   └── Audit
        ↓
Supabase / PostgreSQL
```

Fiscal path:

```text
CFDI Domain
   ↓
Python Fiscal Engine
   ↓
python-satcfdi
   ↓
PAC
   ↓
SAT
```

---

## Suggested Monorepo

```text
maicora/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   ├── mcp/
│   └── fiscal-engine/
│
├── packages/
│   ├── auth/
│   ├── tenancy/
│   ├── database/
│   ├── customers/
│   ├── catalog/
│   ├── inventory/
│   ├── pricing/
│   ├── invoices/
│   ├── cfdi/
│   ├── capabilities/
│   ├── agent/
│   ├── memory/
│   ├── proposals/
│   ├── audit/
│   ├── contracts/
│   ├── ui/
│   └── shared/
│
├── evals/
├── docs/
├── infra/
│   └── docker/
│
└── docker-compose.yml
```

Do not create empty packages for deferred modules merely to look architecturally sophisticated.
