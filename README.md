# Maicora

An agent-first business management system for small Mexican businesses:
customers, catalogue, inventory, true-cost pricing and CFDI invoicing, all
driven either from the screens or from a conversation with an assistant that
can only act through the same governed operations a person uses.

The specification this implements lives in [docs/mvp](./docs/mvp/). The rules
the code is held to live in [AGENTS.md](./AGENTS.md).

## How it is put together

| Piece | What it is | Where |
| --- | --- | --- |
| `apps/api` | Fastify HTTP API. Owns every database write and every call to Supabase. | TypeScript |
| `apps/web` | React SPA. Talks only to the API. | TypeScript |
| `apps/mcp` | MCP server exposing the same capabilities to external agent clients. | TypeScript |
| `apps/fiscal-engine` | CFDI building, sealing and stamping. Isolated from the rest. | Python |
| `packages/*` | Domain services: customers, catalog, inventory, pricing, invoices, proposals, capabilities, agent, auth, audit, imports. | TypeScript |

Four ideas carry the design:

1. **Every write is a proposal first.** A fiscal document, a stock correction
   or a price change is drafted, shown as a business diff in plain language,
   approved by a person, and only then executed. Approval and execution are
   two separate calls.
2. **The capability registry is the only way in.** The screens and the agent
   call the same registered capabilities under the same permission checks, so
   they cannot show different data or allow different actions.
3. **Inventory is a ledger.** Quantities are derived from movements; nothing
   writes a balance directly.
4. **The LLM does no arithmetic and sees no raw database.** Pricing, tax and
   totals come from deterministic services.

## Running it

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env
docker compose up -d postgres fiscal-engine
pnpm install
pnpm db:migrate
pnpm dev:api        # http://localhost:4000
pnpm dev:web        # http://localhost:5173
```

To sign in without a Supabase project, set in `.env`:

```
SUPABASE_JWT_SECRET=any-long-random-string
AUTH_DEV_LOGIN=true
```

Any email is then accepted at the login screen and the first company you
create makes you its owner. The API refuses this mode when `NODE_ENV` is
`production`.

The whole stack, including the API, the MCP server and a built web bundle:

```bash
docker compose up --build
```

Tests (integration tests need a `maicora_test` database on the same Postgres):

```bash
pnpm test
npx vitest run evals/golden.test.ts   # the agent behaviour evals
```

Vitest's include patterns are repo-root-relative, so run suites from the repo
root; `pnpm --filter <package> test` reports no test files.

## What actually works

Everything in `docs/mvp` is implemented end to end against local Postgres:
authentication and tenant membership, fixed-role permissions, the customer,
product, inventory and invoice domains, cost models and true-cost pricing, the
proposal and approval flow with change sets and a revert path, the audit log,
bulk CSV import, the agent with streaming and tool use, and the MCP server.
107 tests and 12 golden evals pass.

## What is stubbed, and what it would take

- **The PAC is a mock.** `apps/fiscal-engine` builds real CFDI 4.0 XML and
  runs the full request/response shape a PAC integration needs, but the
  sandbox provider returns a synthetic UUID instead of a stamped document.
  Swap in a real provider behind the same interface in `app/pac.py`.
- **No CSD sealing.** The certificate and key are referenced, never stored;
  the mock provider does not sign. Real sealing needs the .cer/.key resolved
  from a secret store inside the fiscal engine.
- **No PDF.** The mock PAC returns no `pdfBase64`, so nothing renders one.
- **Without `AI_API`/`AI_API_KEY` the agent answers with a fixed message.**
  Set them and the same code path drives a real model.
- **CSV import maps columns by header name.** The agent-assisted field mapping
  described in chapter 11 is not built; a file with different headers is
  rejected rather than guessed at.
- **Invoice XML is stored on the local filesystem**, which is correct for a
  self-hosted install and wrong for more than one API instance.

Every other deliberate shortcut in the code is marked with a `ponytail:`
comment naming its ceiling and the upgrade path.
