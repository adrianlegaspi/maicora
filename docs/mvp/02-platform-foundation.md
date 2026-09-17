# 2. Platform Foundation

> Part of the [Maicora MVP Specification](./index.md).

---

## Foundation Is Not Trimmed

The smaller business scope does **not** mean a throwaway architecture.

Keep:

- Monorepo
- TypeScript as primary language
- React frontend
- Node.js / TypeScript backend
- PostgreSQL through Supabase
- Supabase Auth behind backend only
- Drizzle ORM + migrations
- Docker-first development
- Multi-tenancy
- Multi-company user membership
- Roles and permissions
- Agent runtime
- OpenAI-compatible AI API abstraction
- Persistent AI memory
- Capability registry
- MCP adapter
- Business Proposals
- Business Diff
- Approval system
- ChangeSets
- Audit logs
- Python fiscal engine
- `python-satcfdi`
- PAC abstraction
- Sandbox / production fiscal environments

---

## AI Configuration

Minimum:

```env
AI_API=https://provider.example/v1
AI_API_KEY=secret
```

Rules:

- Backend only.
- Frontend never receives credentials.
- OpenAI-compatible API contract.
- Provider-specific code isolated.
- Model identifier stored as application configuration.
- Self-hosters may use compatible local or hosted providers.
