# Databases

**One PostgreSQL database per API.** Locally they share one PostgreSQL
server; in production they can share a server or move to separate ones.

| API      | Database     | Runtime role (RLS-bound) | Owner role (migrations, events) |
| -------- | ------------ | ------------------------ | ------------------------------- |
| platform | `platform`   | `platform_app`           | `platform_owner`                |
| Sugrpay  | `invoicing`  | `invoicing_app`          | `invoicing_owner`               |
| HQ       | `hq` (later) | `hq_app`                 | `hq_owner`                      |

Each API has its own Prisma schema (`apps/platform/prisma/schema.prisma`,
`apps/sugrpay/prisma/schema.prisma`), its own migrations next to it, and its
own generated client (`apps/<api>/generated`, imported only through
`apps/<api>/src/modules/database/client.ts`). An API's code cannot even see
another API's models.

Zoho Books connections live in Sugrpay's own `zoho_connection` table
(migration `20261024000000_zoho_connection`); before the split they were rows
in the platform's `integration_connection` table.
`pnpm db:move-zoho-connections` copies those rows across (safe to repeat; the
deploy runs it).

## Configuration

```
PLATFORM_DATABASE_URL          runtime role
PLATFORM_DIRECT_DATABASE_URL   owner role
INVOICING_DATABASE_URL
INVOICING_DIRECT_DATABASE_URL
DATABASE_ADMIN_URL             superuser, used only by `pnpm db:bootstrap`
```

`pnpm db:bootstrap` creates each database and both of its roles, and revokes
`CONNECT` from everyone else — so `invoicing_app` cannot connect to the
platform database at all.

## Tenant isolation inside each database

Three layers (TDD-001 §6.1), applied in every API's database:

1. The request guard resolves an immutable scope (merchant, brands, role).
2. Services filter by it.
3. **Row-level security** is the backstop: each API's Prisma service pushes
   the scope into the transaction (`set_config(..., is_local)`), and every
   policy reads it. No scope means no rows.

The runtime role is never the table owner (owners bypass RLS). Cross-tenant
work — the public payment page, event handlers, reconciliation — goes through
the owner connection, via a conspicuously named `withoutScope(reason, …)`.

The scope itself comes from the platform (it resolves sessions; Sugrpay asks
it over `POST /internal/sessions/resolve`). Sugrpay checks brands against its
own read-only copy of the brands, so it never touches the platform's database.

## Commands

| Command                                           | Does                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm db:bootstrap`                               | Create the databases and roles (idempotent; `scripts/db/bootstrap.ts`) |
| `pnpm db:generate`                                | Generate each API's Prisma client                                      |
| `pnpm db:migrate`                                 | Apply each API's migrations                                            |
| `pnpm db:seed`                                    | Development data for every database (`scripts/db/seed.ts`)             |
| `pnpm db:reset`                                   | Reset every database, then seed (local only — guarded)                 |
| `pnpm db:studio:platform` / `db:studio:invoicing` | Browse one database                                                    |
| `pnpm db:migrate-legacy`                          | Copy a pre-split single database into the per-module databases         |
| `pnpm db:move-zoho-connections`                   | Copy Zoho Books connections from the platform database into Sugrpay's  |
