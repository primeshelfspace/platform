# Principles that must not break

Rules the whole codebase relies on. Changing one is an architecture decision,
not a refactor.

## Money is never a float

Every amount is an integer number of **minor units** (cents) and every rate an
integer number of **basis points** (6% = 600), end to end: database columns,
the API, and all arithmetic. `packages/kernel/src/money/` is the only place
money is calculated, and its `calculation.ts` is the single code path behind
the figure on the invoice, the PDF, the payment page and the Zoho push. The
TDD-001 §9.3 worked example is both a test fixture and a seeded invoice.

## Tenant isolation is three layers, not one

1. The request guard resolves an immutable **scope** (company, brands, role)
   from the session.
2. Services filter their queries by it.
3. PostgreSQL **row-level security** is the backstop: a forgotten filter
   returns nothing, never another company's data.

The runtime database connection deliberately uses a non-owner role, because a
table owner bypasses row-level security. `apps/*/src/modules/database/rls.test.ts`
proves all of this against real databases. See [databases.md](databases.md).

**Before you touch it:** each API's Prisma service (`PlatformPrismaService`,
`InvoicingPrismaService`) offers `withoutScope(reason, …)` as the only
legitimate way to read data before a scope exists — the public payment page
resolving a token to its brand, an event handler, a reconciliation job. It
runs on the owner connection (`*_DIRECT_DATABASE_URL`) so it bypasses row-level
security for real; simply skipping the scope on the normal connection would
return nothing, because every policy treats "no scope" as "deny".

## APIs stay walled off

Each API is its own program and owns its database; others ask it over its
`/internal/...` routes or listen to its events, never import its code. The
platform never depends on a product, and products never depend on each other.
Enforced by `apps/platform/src/module-boundaries.test.ts`, ESLint and
`pnpm boot-check`. See [modules.md](modules.md) and
[decisions/0005](decisions/0005-separate-apis.md).

## External systems are reached through ports

`PaymentGatewayPort`, `AccountingPort`, `MailPort` and `StoragePort` belong to
the domain; adapters implement them (mail and storage in
`packages/server/src/adapters/`, payment gateway and accounting in
`apps/sugrpay/src/adapters/`) and are bound in one place each. That is why an unfinished gateway contract (Numbers) blocks one
file instead of the whole payment workstream.

## Nothing local reaches a real provider

Gateway, accounting, mail and storage all default to in-repo fakes or local
services. The environment check refuses to start production with a fake bound.
