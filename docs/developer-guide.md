# Developer guide: how the code works

For someone taking over the backend. Read in this order:

1. [getting-started.md](getting-started.md) — run it on your machine.
2. This page — how a request travels through the code, and how to change it.
3. [architecture/](architecture/README.md) — the rules (modules, layers,
   databases, events, access) and why.
4. [api/](api/README.md) — every endpoint.
5. [operations/production.md](operations/production.md) — the live system.

The web app is a separate repository,
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend); its
`docs/architecture.md` is the same kind of guide for that side.

## 1. The shape of it

- **One NestJS API** (`apps/api`) made of walled-off **modules**:
  `modules/platform` (sign-in, companies, brands, users, roles, subscriptions,
  locations, integrations, audit) and `modules/invoicing` (Sugrpay: customers,
  invoices, payments, checks, settings, dashboard, Zoho). HQ is a placeholder.
- **One PostgreSQL database per module** (`platform`, `invoicing`). A module
  never queries another's database: it calls the other module's
  `public-api.ts`, or listens to its events.
- **Inside a feature**, code is layered: `interface/` (controllers) →
  `application/` (services, use cases) → `infrastructure/` (adapters,
  persistence) → `domain/` (pure rules). ESLint enforces the imports.
- **Shared packages** (`packages/`): `kernel` (money, calculations, roles,
  tenancy scope, port interfaces, design tokens), `platform-contracts` and
  `invoicing-contracts` (zod request schemas, events, statuses, email/PDF
  renderers). The web app keeps **copies** of these; this repository is the
  source of truth — after changing them, copy them over (see the front end's
  `packages/README.md`).
- **A second process**, the worker (`src/worker.ts`), runs BullMQ jobs from
  Redis: Zoho push/pull and the scheduled sync.

## 2. A request, end to end

Take `POST /brands/:brandId/invoices` (create an invoice).

| Step | Where                                                                                                                | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `src/main.ts`                                                                                                        | Express receives it (raw body kept for webhook signatures; `trust proxy` for nginx).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2    | `modules/platform/tenancy/interface/authorisation.ts` — `AuthorisationGuard`, registered globally in `app.module.ts` | Reads the session token (`Authorization: Bearer` or cookie), resolves it in the database (`app_resolve_session`) into a **scope**: user, company, role, brands, products, locations. Then checks, in order: the product (`@ProductScope('INVOICING')` → the company subscribes and the user has a Sugrpay role), the permission (`@RequirePermission('INVOICES', 'WRITE')` → the role matrix in `packages/kernel/src/domain/roles.ts`), and the brand (`:brandId` must be reachable). A route with no declaration is refused. |
| 3    | `modules/invoicing/invoices/interface/invoices.controller.ts`                                                        | `@Body(zodPipe(invoiceDraftSchema))` validates the body against the schema in `packages/invoicing-contracts/src/schemas.ts` (400 with field-level `issues` if not). `@CurrentScope()` hands the scope to the handler.                                                                                                                                                                                                                                                                                                         |
| 4    | `modules/invoicing/invoices/application/invoices.service.ts`                                                         | The use case: numbers the invoice, computes totals with `packages/kernel/src/money` (integer **minor units**, basis-point rates — never floats), writes the invoice, its lines and an `invoice_event`.                                                                                                                                                                                                                                                                                                                        |
| 5    | `modules/invoicing/database/invoicing-prisma.service.ts` → `withScope(scope, tx => …)`                               | Every query runs in a transaction that first sets the scope into PostgreSQL (`set_config`), so **row-level security** only lets the company's own rows through — the last line of defence if the code above ever had a bug. `withoutScope(reason, …)` bypasses it, only for deliberate cross-tenant work (public payment page, webhooks, events), and logs the reason.                                                                                                                                                        |
| 6    | Response                                                                                                             | Money comes back in fields ending `Minor` (cents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

When something must reach another module — e.g. a brand changes in the
platform and invoicing keeps a copy of it — the platform writes an event to its
**outbox** table in the same transaction (`modules/platform/events/platform-outbox.ts`),
the dispatcher (`shared/infra/events/outbox-dispatcher.ts`) delivers it on the
in-process event bus, and invoicing's `BrandReplicaProjector`
(`modules/invoicing/platform-sync/application`) applies it once (it records
processed event ids). See [architecture/events.md](architecture/events.md).

### Outside services

Every external system is behind a **port** (interface in
`packages/kernel/src/ports`) with real and fake **adapters** in
`src/shared/adapters/`: payment gateway (Stripe, a fake for local testing,
Numbers placeholder), accounting (Zoho Books, fake), mail (SMTP, console),
storage (S3, local disk). `.env` picks them (`PAYMENT_GATEWAY_DRIVER`, …);
production refuses the fakes for payments, mail and storage.

### Background jobs

Queues are defined in `src/shared/infra/queue/queues.ts`. Only `sync` (Zoho
push/pull) and `scheduled` (the every-minute `scheduled-sync`) have handlers
today; reminders, overdue marking and the rest are declared but not built
(see [known-gaps.md](known-gaps.md)). Email is sent inside the request, not
queued.

## 3. Where things are

| Looking for                                 | Go to                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sign-in, sessions, sign-up, passwords       | `src/modules/platform/auth/`                                                        |
| Who may do what                             | `packages/kernel/src/domain/roles.ts` (matrix), `modules/platform/tenancy/` (guard) |
| Companies and onboarding                    | `src/modules/platform/companies/`                                                   |
| Brands, users, locations, subscriptions     | `src/modules/platform/{brands,users,locations,subscriptions}/`                      |
| Stripe / Square / Authorize.net connections | `src/modules/platform/integrations/`                                                |
| Customers, invoices, payments, checks       | `src/modules/invoicing/{customers,invoices,payments,checks}/`                       |
| Public payment page API, PDF                | `src/modules/invoicing/pay-api/`                                                    |
| Brand settings (methods, templates, PDF)    | `src/modules/invoicing/settings/`                                                   |
| Zoho Books                                  | `src/modules/invoicing/zoho-sync/` and `src/shared/adapters/accounting/`            |
| Dashboard figures                           | `src/modules/invoicing/dashboard/`                                                  |
| Database schemas and migrations             | `apps/api/prisma/{platform,invoicing}/`                                             |
| Environment variables                       | `src/shared/config/env.ts` (validated at start-up)                                  |
| Request/response shapes                     | `packages/*-contracts/src/schemas.ts`                                               |
| Invoice status rules                        | `packages/invoicing-contracts/src/invoice-status.ts`                                |

## 4. Making changes

**Add an endpoint**

1. Schema for the body/query in the module's contracts package.
2. Handler in the feature's `interface/*.controller.ts` with
   `@RequirePermission(…)` (and the module's `@ProductScope` is on the class).
   No declaration = refused, and `authorisation-coverage.test.ts` fails.
3. Logic in `application/`, database access through `withScope`.
4. A description in `scripts/api-reference.mjs`, then `pnpm docs:api` —
   `pnpm check` fails until you do.
5. A test next to the service (`*.test.ts`, vitest, real database).

**Change a database table**

1. Edit `apps/api/prisma/<module>/schema.prisma`.
2. `pnpm --filter @platform/api exec prisma migrate dev --schema prisma/<module>/schema.prisma --name <what>`
   (local only), then add RLS policies/grants for a new table in the same
   migration — copy an existing table's from the `rls_and_grants` migration.
3. `pnpm db:generate`. Production applies it on the next deploy.

**Change a shared package** (`kernel`, `*-contracts`): change it here, run
`pnpm check`, then copy it into sugrpay-frontend (`packages/README.md` there).

**Add an environment variable**: add it to `src/shared/config/env.ts` (with a
default or a production rule), `.env.example` and
`deploy/.env.production.example`; on the server use
`deploy/production/update-secrets.sh` (extend its key list) or edit `.env` and
restart.

## 5. Checks and tests

| Command                     | Does                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm db:seed && pnpm test` | All tests (468+), many against the real local databases — seed first                           |
| `pnpm check`                | Formatting, lint (module and layer rules), dependency check, API docs up to date, types, tests |
| `pnpm boot-check`           | The API starts with no product, and with each product                                          |

GitHub Actions ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml))
runs formatting, lint, dependency, docs, type and package checks on every push
to `main`, then deploys. The database-backed tests run locally.

## 6. Conventions that matter

- **Money is integer minor units**; only `packages/kernel/src/money` does
  arithmetic on it. Never floats.
- **Tenant isolation is in three layers**: the guard, the service's own
  filters, and row-level security. Keep all three.
- **Modules talk through `public-api.ts` or events**, never each other's
  internals or databases (`module-boundaries.test.ts` and ESLint check this).
- **Failing closed**: unknown route permissions, unknown brands and invalid
  config all refuse rather than guess.
- **Comments explain why**, with the requirement id (FR-…, NFR-…, TDD-…) from
  `docs/product/` where there is one.
