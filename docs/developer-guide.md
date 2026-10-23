# Developer guide: how the code works

For someone taking over the backend. Read in this order:

1. [getting-started.md](getting-started.md) — run it on your machine.
2. This page — how a request travels through the code, and how to change it.
3. [architecture/](architecture/README.md) — the rules (APIs, layers,
   databases, events, access) and why.
4. [api/](api/README.md) — every endpoint.
5. [operations/production.md](operations/production.md) — the live system.

The web app is a separate repository,
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend); its
`docs/architecture.md` is the same kind of guide for that side.

## 1. The shape of it

- **Three NestJS APIs**, each its own program, port and database
  ([decision 0005](architecture/decisions/0005-separate-apis.md)):
  - `apps/platform` (port 4001, database `platform`): sign-in, companies,
    brands, users, roles, subscriptions, locations, Stripe/Square/Authorize.Net
    connections, audit, the platform event outbox.
  - `apps/sugrpay` (port 4002, database `invoicing`): customers, invoices,
    payments, checks, the public payment page, brand settings, dashboard,
    Zoho Books.
  - `apps/hq` (port 4003): a skeleton that starts, answers `/health` and
    resolves sessions. No database yet.
- **No API imports another or reads its database.** Sugrpay reaches the
  platform only over HTTP, through `apps/sugrpay/src/modules/platform-access/`,
  which calls the platform's `/internal/...` routes. The platform tells Sugrpay
  about changes with events, delivered to Sugrpay's `POST /internal/events`.
- **Inside a feature**, code is layered: `interface/` (controllers) →
  `application/` (services, use cases) → `infrastructure/` (adapters,
  persistence) → `domain/` (pure rules). ESLint enforces the imports.
- **Shared packages** (`packages/`): `server` (what every API shares:
  configuration, the request guard, mail, storage, Redis, the outbox
  dispatcher, rate limits, security headers, health), `kernel` (money,
  calculations, roles, tenancy scope, port interfaces, design tokens),
  `platform-contracts` and `invoicing-contracts` (zod request schemas, events,
  statuses, email/PDF renderers, and `apiServiceFor`, which says which API
  serves a path). The web app keeps **copies** of `kernel` and the contracts;
  this repository is the source of truth — after changing them, copy them
  over (see the front end's `packages/README.md`).
- **Sugrpay's worker** (`apps/sugrpay/src/worker.ts`), a separate process,
  runs BullMQ jobs from Redis: Zoho push/pull and the scheduled sync. The
  platform runs no worker.

## 2. A request, end to end

Take `POST /brands/:brandId/invoices` (create an invoice). `apiServiceFor`
says it is Sugrpay's, so the web app sends it to the Sugrpay API (in
production, `api.sugrpay.com` would pass it there too).

| Step | Where                                                                                                      | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `apps/sugrpay/src/main.ts` → `configureApp` (`packages/server/src/app-setup.ts`)                           | Express receives it (raw body kept for webhook signatures; `trust proxy` for nginx; CORS and security headers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2    | `AuthorisationGuard` (`packages/server/src/auth/authorisation.ts`), registered globally in `app.module.ts` | Reads the session token (`Authorization: Bearer` or cookie) and asks the API's `ScopeResolver` for the **scope**: user, company, role, brands, products, locations. In Sugrpay that is `RemoteScopeResolver`, which calls the platform's `POST /internal/sessions/resolve`; in the platform it is `SessionService` (`app_resolve_session` in the database). Then checks, in order: the product (`@ProductScope('INVOICING')` → the company subscribes and the user has a Sugrpay role), the permission (`@RequirePermission('INVOICES', 'WRITE')` → the role matrix in `packages/kernel/src/domain/roles.ts`), and the brand (`:brandId` must be reachable — Sugrpay answers this from its own copy of the brands). A route with no declaration is refused. |
| 3    | `apps/sugrpay/src/modules/invoices/interface/invoices.controller.ts`                                       | `@Body(zodPipe(invoiceDraftSchema))` validates the body against the schema in `packages/invoicing-contracts/src/schemas.ts` (400 with field-level `issues` if not). `@CurrentScope()` hands the scope to the handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4    | `apps/sugrpay/src/modules/invoices/application/invoices.service.ts`                                        | The use case: numbers the invoice, computes totals with `packages/kernel/src/money` (integer **minor units**, basis-point rates — never floats), writes the invoice, its lines and an `invoice_event`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5    | `apps/sugrpay/src/modules/database/invoicing-prisma.service.ts` → `withScope(scope, tx => …)`              | Every query runs in a transaction that first sets the scope into PostgreSQL (`set_config`), so **row-level security** only lets the company's own rows through — the last line of defence if the code above ever had a bug. `withoutScope(reason, …)` bypasses it, only for deliberate cross-tenant work (public payment page, webhooks, events), and logs the reason.                                                                                                                                                                                                                                                                                                                                                                                      |
| 6    | Response                                                                                                   | Money comes back in fields ending `Minor` (cents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

When something must reach another API — e.g. a brand changes in the platform
and Sugrpay keeps a copy of it — the platform writes an event to its
**outbox** table in the same transaction
(`apps/platform/src/modules/events/platform-outbox.ts`). The dispatcher
(`packages/server/src/events/outbox-dispatcher.ts`) hands it to the platform's
`EventForwarder` (`apps/platform/src/modules/internal/event-forwarder.ts`),
which posts it to Sugrpay's `POST /internal/events`. Sugrpay puts it on its own
event bus, and its `BrandReplicaProjector`
(`apps/sugrpay/src/modules/platform-sync/application`) applies it once (it
records processed event ids). See [architecture/events.md](architecture/events.md).

When Sugrpay needs an answer from the platform now — a brand's Stripe
account, writing an audit entry, setting a brand's colour — it calls the
platform's `/internal/...` routes through `PlatformApiClient`
(`apps/sugrpay/src/modules/platform-access/`), sending `INTERNAL_API_KEY`.

### Outside services

Every external system is behind a **port** (interface in
`packages/kernel/src/ports`) with real and fake **adapters**: mail (SMTP,
console) and storage (S3, local disk) in `packages/server/src/adapters/`,
used by every API; payment gateway (Stripe, a fake for local testing, Numbers
placeholder) and accounting (Zoho Books, fake) in
`apps/sugrpay/src/adapters/`. `.env` picks them (`PAYMENT_GATEWAY_DRIVER`, …);
production refuses the fakes for payments, mail and storage.

### Background jobs

Queues are defined in `apps/sugrpay/src/infra/queue/queues.ts`. Only `sync`
(Zoho push/pull) and `scheduled` (the every-minute `scheduled-sync`) have
handlers today; reminders, overdue marking and the rest are declared but not
built (see [known-gaps.md](known-gaps.md)). Email is sent inside the request,
not queued.

## 3. Where things are

| Looking for                                 | Go to                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sign-in, sessions, sign-up, passwords       | `apps/platform/src/modules/auth/`                                                                   |
| Who may do what                             | `packages/kernel/src/domain/roles.ts` (matrix), `packages/server/src/auth/authorisation.ts` (guard) |
| Companies and onboarding                    | `apps/platform/src/modules/companies/`                                                              |
| Brands, users, locations, subscriptions     | `apps/platform/src/modules/{brands,users,locations,subscriptions}/`                                 |
| Stripe / Square / Authorize.net connections | `apps/platform/src/modules/integrations/`                                                           |
| The platform's internal routes              | `apps/platform/src/modules/internal/`                                                               |
| Customers, invoices, payments, checks       | `apps/sugrpay/src/modules/{customers,invoices,payments,checks}/`                                    |
| Public payment page API, PDF                | `apps/sugrpay/src/modules/pay-api/`                                                                 |
| Brand settings (methods, templates, PDF)    | `apps/sugrpay/src/modules/settings/`                                                                |
| Zoho Books                                  | `apps/sugrpay/src/modules/zoho-sync/` and `apps/sugrpay/src/adapters/accounting/`                   |
| Dashboard figures                           | `apps/sugrpay/src/modules/dashboard/`                                                               |
| How Sugrpay reaches the platform            | `apps/sugrpay/src/modules/platform-access/`                                                         |
| Which API serves a path                     | `packages/platform-contracts/src/api-routing.ts` (`apiServiceFor`)                                  |
| Database schemas and migrations             | `apps/platform/prisma/`, `apps/sugrpay/prisma/`                                                     |
| Environment variables                       | `packages/server/src/config/env.ts` (validated at start-up)                                         |
| Request/response shapes                     | `packages/*-contracts/src/schemas.ts`                                                               |
| Invoice status rules                        | `packages/invoicing-contracts/src/invoice-status.ts`                                                |

## 4. Making changes

**Add an endpoint**

1. Schema for the body/query in the API's contracts package.
2. Handler in the feature's `interface/*.controller.ts` with
   `@RequirePermission(…)` (and the module's `@ProductScope` is on the class).
   No declaration = refused, and the API's `authorisation-coverage.test.ts`
   fails.
3. If the route belongs to Sugrpay, its path must match `apiServiceFor`
   (`packages/platform-contracts/src/api-routing.ts`) and the same rule in
   `deploy/nginx/api.conf`; the coverage test checks that every route routes
   to its own API.
4. Logic in `application/`, database access through `withScope`.
5. A description in `scripts/api-reference.mjs`, then `pnpm docs:api` —
   `pnpm check` fails until you do.
6. A test next to the service (`*.test.ts`, vitest, real database).

**Change a database table**

1. Edit `apps/<platform|sugrpay>/prisma/schema.prisma`.
2. `pnpm --filter @platform/sugrpay-api exec node ../../scripts/with-env.mjs prisma migrate dev --schema prisma/schema.prisma --name <what>`
   (or `@platform/platform-api`; local only), then add RLS policies/grants for a
   new table in the same migration — copy an existing table's from the
   `rls_and_grants` migration.
3. `pnpm db:generate`. Production applies it on the next deploy.

**Change a shared package** (`kernel`, `*-contracts`): change it here, run
`pnpm check`, then copy it into sugrpay-frontend (`packages/README.md` there).

**Add an environment variable**: add it to `packages/server/src/config/env.ts`
(with a default or a production rule), `.env.example` and
`deploy/.env.production.example`; on the server use
`deploy/production/update-secrets.sh` (extend its key list) or edit `.env` and
restart.

## 5. Checks and tests

| Command                     | Does                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm db:seed && pnpm test` | All tests (468+), many against the real local databases — seed first                           |
| `pnpm check`                | Formatting, lint (API and layer rules), dependency check, API docs up to date, types, tests    |
| `pnpm boot-check`           | Builds, then starts each API (platform, Sugrpay, HQ) on its own and checks it comes up healthy |

The end-to-end user journeys (`e2e/user-journeys.test.ts`) start the platform
and Sugrpay APIs in one test process and send each call to the API that owns
it (`apiServiceFor`), as the web app does.

GitHub Actions ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml))
runs formatting, lint, dependency, docs, type and package checks on every push
to `main`, then deploys. The database-backed tests run locally.

## 6. Conventions that matter

- **Money is integer minor units**; only `packages/kernel/src/money` does
  arithmetic on it. Never floats.
- **Tenant isolation is in three layers**: the guard, the service's own
  filters, and row-level security. Keep all three.
- **APIs talk over `/internal` HTTP or events**, never through each other's
  code or databases (`apps/platform/src/module-boundaries.test.ts` and ESLint
  check this). `/internal/` routes are `@InternalOnly()`: they need the shared
  `INTERNAL_API_KEY`, and nginx refuses them from the internet.
- **Failing closed**: unknown route permissions, unknown brands and invalid
  config all refuse rather than guess.
- **Comments explain why**, with the requirement id (FR-…, NFR-…, TDD-…) from
  `docs/product/` where there is one.
