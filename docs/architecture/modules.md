# APIs and modules

The backend is three **APIs**, each a top-level folder under `apps/`:
`platform`, `sugrpay`, `hq`. Each is its own program, with its own port,
database and deploy unit. Everything an API owns — its code, its database, its
events — lives inside its folder. Inside an API, a **module** is a feature
folder under `src/modules/` (`auth`, `brands`, `invoices`, …). Why it is
built this way: [decisions/0005](decisions/0005-separate-apis.md).

## The rules

1. **Each table belongs to exactly one API**, in that API's own database. No
   other API reads or writes it.
2. **One-way dependencies.** Products depend on the platform. The platform
   never depends on a product. Products never depend on each other.
3. **No API imports another API's code.** They talk only over HTTP:
   - **Ask** — call the platform's `/internal/...` routes (an answer is
     needed now). See [below](#how-the-apis-talk).
   - **Tell** — publish an event (something happened). See [events.md](events.md).
4. **Shared building blocks go in packages**, never in an app:
   `@platform/server` (plumbing), `@platform/kernel`, and the contracts
   packages. Packages never import an app.
5. **Copy what you need to keep.** An API that needs another API's data for
   joins or history keeps its own copy, fed by events (Sugrpay's read-only
   `brand` table), or stores the value at the time it was used (an invoice
   keeps the item name and price it was issued with).

## How the APIs talk

| Direction          | How                                                                                                                               | Where                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sugrpay → platform | HTTP to `PLATFORM_INTERNAL_URL` + `/internal/...`, sending `INTERNAL_API_KEY`                                                     | `apps/sugrpay/src/modules/platform-access/` (`PlatformApiClient`) |
| Platform → Sugrpay | Events: the platform's outbox hands each event to `EventForwarder`, which posts it to `SUGRPAY_INTERNAL_URL` + `/internal/events` | `apps/platform/src/modules/internal/event-forwarder.ts`           |
| HQ → platform      | Resolves sessions over `/internal/sessions/resolve`, like Sugrpay                                                                 | `apps/hq/src/platform-access/`                                    |

The platform's internal routes (`apps/platform/src/modules/internal/`):
resolve a session, a brand's Stripe account, which brand a Stripe account
belongs to, set a brand's colour, write an audit entry. They are marked
`@InternalOnly()` and checked by `InternalKeyGuard` (both in
`@platform/server`); nginx refuses `/internal/` from the internet. The full
list is in [api/endpoints.md](../api/endpoints.md#internal-api-to-api).

Inside Sugrpay, `platform-access/` keeps the names the code used before the
split: `AuditLogService`, `BrandsService`, `StripeAccountService` and
`SystemScopeResolver` call the platform's internal API or read Sugrpay's own
copy of the brands. `RemoteScopeResolver` plugs into the shared request guard
(`SCOPE_RESOLVER`) and resolves each session through the platform.

## Enforced by the build

Every rule is checked by the linter as you type (`pnpm lint`,
`eslint.config.mjs`), and the import rules also by the test suite
(`apps/platform/src/module-boundaries.test.ts`).

| Check                                                                                 | Where                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| No app imports another app's code                                                     | `pnpm lint`, `module-boundaries.test.ts`    |
| No app lists another app as a dependency                                              | `module-boundaries.test.ts`                 |
| Packages never import an app                                                          | `pnpm lint`, `module-boundaries.test.ts`    |
| The platform (and `server`, `platform-contracts`) never imports a product's contracts | `pnpm lint`                                 |
| Feature layers: pure domain, interface never touches data directly                    | `pnpm lint`                                 |
| The kernel depends on nothing above it                                                | `pnpm lint`                                 |
| An API's database role can't reach another API's database                             | `apps/*/src/modules/database/rls.test.ts`   |
| Every route is served by the API that `apiServiceFor` sends it to                     | each API's `authorisation-coverage.test.ts` |
| Each API starts with no other API running                                             | `pnpm boot-check`                           |

## Inside an API

```
apps/<api>/
  src/
    main.ts              HTTP entry point (configureApp from @platform/server)
    app.module.ts        composition root: the API's modules + shared guards
    modules/
      database/          this API's Prisma client, service, RLS tests
      events/            events this API publishes (contracts) — platform today
      <feature>/         one folder per feature (invoices, payments, auth, ...)
                         organised in layers — see layers.md
      README.md          what the API owns, what it calls, what it listens to
  prisma/
    schema.prisma        this API's database schema
    migrations/
  package.json           @platform/<api>-api
```

Sugrpay also has `src/worker.ts` (the background worker),
`src/adapters/` (payment gateway, accounting), `src/infra/queue/` and
`src/modules/platform-access/`.

Tests (`*.test.ts`) and test helpers (`*.test-support.ts`) sit inside the API
they test. The end-to-end journeys in `e2e/` start both APIs and drive them
over HTTP only.

## Running each API alone

Each API is started on its own (`pnpm boot-check` proves it: it starts the
platform, Sugrpay and HQ one at a time and checks each comes up healthy on
`/health/ready`).
Sugrpay boots without the platform; it needs the platform only to answer
signed-in requests, and answers 503 while the platform is unreachable.
