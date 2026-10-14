# Databases

**One PostgreSQL database per module.** Locally they share one PostgreSQL
server; in production they can share a server or move to separate ones.

| Module    | Database     | Runtime role (RLS-bound) | Owner role (migrations, events) |
| --------- | ------------ | ------------------------ | ------------------------------- |
| platform  | `platform`   | `platform_app`           | `platform_owner`                |
| invoicing | `invoicing`  | `invoicing_app`          | `invoicing_owner`               |
| hq        | `hq` (later) | `hq_app`                 | `hq_owner`                      |

Each module has its own Prisma schema (`apps/api/prisma/<module>/schema.prisma`),
its own migrations next to it, and its own generated client
(`apps/api/generated/<module>`, imported only through
`modules/<module>/database/client.ts`). A module's code cannot even see another
module's models.

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

Three layers (TDD-001 §6.1), applied in every module's database:

1. The request guard resolves an immutable scope (merchant, brands, role).
2. Services filter by it.
3. **Row-level security** is the backstop: each module's Prisma service pushes
   the scope into the transaction (`set_config(..., is_local)`), and every
   policy reads it. No scope means no rows.

The runtime role is never the table owner (owners bypass RLS). Cross-tenant
work — the public payment page, event handlers, reconciliation — goes through
the owner connection, via a conspicuously named `withoutScope(reason, …)`.

The scope itself comes from the platform (it resolves sessions). Invoicing
checks it against its own read-only copy of the brands, so it never asks the
platform's database.

## Commands

| Command                   | Does                                               |
| ------------------------- | -------------------------------------------------- |
| `pnpm db:bootstrap`       | Create module databases and roles (idempotent)     |
| `pnpm db:migrate`         | Apply every module's migrations                    |
| `pnpm db:seed`            | Development data for every module                  |
| `pnpm db:reset`           | Reset every module database (local only — guarded) |
| `pnpm db:studio:<module>` | Browse one module's database                       |
| `pnpm db:migrate-legacy`  | Copy a pre-split single database into the modules  |
