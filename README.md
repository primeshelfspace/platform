# Platform

One platform, several products. The platform owns what every product needs —
login, companies, brands, users, roles, integrations, audit and (soon)
subscriptions — and each product is built on top of it:

- **Sugrpay** (invoicing) — send invoices and get paid. The first product.
- **HQ** — products, stock, suppliers and stores. Placeholder only for now
  (`apps/hq`, `apps/api/src/hq`).

## Architecture

A **modular monolith**: one NestJS backend made of walled-off modules —
`platform` (shared core) and one module per product — each with **its own
PostgreSQL database**. Modules talk only through each other's `public-api.ts`
(ask) or through events (tell). Inside every feature, code is organised in
clean-architecture layers: `domain` → `application` → `infrastructure` /
`interface`. All of it is enforced by tests, not convention.

```
apps/api/src/
  modules/platform/    auth, companies, brands, users, tenancy, integrations, audit, events
  modules/invoicing/   Sugrpay: customers, invoices, payments, pay API, settings, Zoho sync
  modules/hq/          HQ (placeholder)
  shared/              adapters, infra, config, common, health
apps/invoicing/        Sugrpay admin (Next.js)
apps/payment/          public payment pages (Next.js)
packages/shared, ui    domain kernel and React components shared by every app
```

**Read more:** [docs/architecture](docs/architecture/README.md) — modules,
layers, databases, events, adding a product, and the decision records behind
them.

## Quick start

```bash
pnpm install
pnpm setup:local     # .env, services, both databases, migrations, seed
pnpm dev
```

`setup:local` creates the module databases and their roles through
`DATABASE_ADMIN_URL` (a PostgreSQL superuser — `sugrpay/sugrpay` with
docker-compose; on a native install, usually `postgres`). It works on macOS,
Linux and Windows.

Ports come from `.env` (`ADMIN_PORT`, `PAYMENT_PORT`, `API_PORT`) — the URLs
below assume the defaults.

| Surface       | URL                          | Notes                                   |
| ------------- | ---------------------------- | --------------------------------------- |
| Sugrpay admin | http://localhost:3000        | Sign-in required — see below            |
| Payment app   | http://localhost:3001        | Anonymous, strict CSP                   |
| API           | http://localhost:4000/health | Shows both module databases             |
| Mail          | http://localhost:1080        | Every outbound message is captured here |

**Signing in.** Every page of `apps/invoicing` is behind `/login` (FR-AUTH-001).
`pnpm db:seed` creates one user per role, all sharing the same development
password, so signing in as each is how you exercise the permission matrix:

```
password: sugrpay-dev-password
```

| Email                    | Role           | Brands                     |
| ------------------------ | -------------- | -------------------------- |
| owner@sugrpay.test       | MERCHANT_OWNER | all                        |
| admin@sugrpay.test       | MERCHANT_ADMIN | all                        |
| brand.admin@sugrpay.test | BRAND_ADMIN    | Solstice, Meridian         |
| finance@sugrpay.test     | FINANCE_USER   | Solstice, Meridian, Cobalt |
| sales@sugrpay.test       | SALES_USER     | Solstice                   |
| readonly@sugrpay.test    | READ_ONLY      | Solstice, Cobalt           |

The admin app is a back-end-for-front-end: `POST /auth/login` returns the
session token, the app stores it in its own httpOnly cookie, and replays it
upstream from the server. The token never reaches the browser.

To call the API directly, the seed also writes a long-lived session:

```bash
curl -H "Authorization: Bearer <token printed by db:seed>" http://localhost:4000/health
```

Five _consecutive_ failed sign-ins within fifteen minutes lock an account for
thirty (FR-AUTH-002); a successful sign-in resets the run. To clear a lock
while developing, re-run `pnpm db:seed`.

**If a port is already taken** by something else on your machine, change it in
`.env` and restart (`NEXT_PUBLIC_API_URL` must match `API_PORT`). `.env` is not
picked up live.

**Docker is the documented path** for local services (`docker-compose.yml`). If
Docker is absent, `pnpm services:up` uses locally installed PostgreSQL and
Redis (Homebrew on macOS; on Windows, the PostgreSQL service and Memurai)
plus an in-repo SMTP sink.

## Moving an existing installation

A pre-split, single-database installation is copied into the module
databases with:

```bash
LEGACY_DATABASE_URL=postgresql://<owner>@<host>/<old db> pnpm db:migrate-legacy
```

It needs the module databases bootstrapped, migrated and empty; reads the old
database only; keeps every id (sessions, payment links, Zoho ids carry over);
and fails unless every table's row count matches.

## Testing the invoice → payment flow

The one thing worth actually clicking through. Everything below runs against
`FakeGatewayAdapter` (`PAYMENT_GATEWAY_DRIVER=fake`, the default) — no real
money, no external service, fully deterministic.

1. **Add a customer** — http://localhost:3000/customers → _Add customer_.
2. **Create and issue an invoice** — http://localhost:3000/invoices →
   _Create invoice_ → pick the customer, add a line item or two, _Create &
   issue_. You land back on the invoice list with a real payment link.
3. **Open the payment link** and pay. FakeGateway reads the outcome off the
   **last two digits of the amount actually charged** (which includes the
   card fee, when card is the method) — so you can provoke each path on
   purpose by nudging a line item's price:

   | Last two digits | Outcome                                                           |
   | --------------- | ----------------------------------------------------------------- |
   | anything else   | succeeds — invoice goes to `PAID`, balance clears                 |
   | `11`            | declines — invoice reverts to whatever it was before the attempt  |
   | `22`            | goes `PENDING_PAYMENT`, like a real ACH transfer, and stays there |
   | `33`            | simulated gateway timeout                                         |

4. **Settling a pending payment** has no button in the UI yet — it only
   happens through a signed gateway webhook. To do it by hand:

   ```bash
   # gateway_reference for the payment, from the DB (owner role bypasses RLS):
   psql "$DIRECT_DATABASE_URL" -tA -c \
     "SELECT gateway_reference FROM payment WHERE invoice_id = '<id>';"

   BODY='{"id":"evt_1","type":"PAYMENT_SUCCEEDED","gatewayReference":"<ref>","amountMinor":<amount>,"currency":"USD","occurredAt":"2026-01-01T00:00:00.000Z"}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "fake-gateway-local-secret" -hex | sed 's/^.* //')
   curl -X POST -H "Content-Type: application/json" -H "x-fake-signature: $SIG" \
     -d "$BODY" http://localhost:4000/public/webhooks/fake-gateway
   ```

   The signing secret (`fake-gateway-local-secret`) is exported from
   `apps/api/src/shared/adapters/gateway/fake-gateway.adapter.ts` for exactly this —
   it is not a real secret and never should be one.

Card fee only appears on card/wallet payments, never ACH — pay the same
invoice's link twice by different methods to see the total actually differ.

## The parts that are load-bearing

**Money is never a float.** Every amount is an integer count of minor units and
every rate an integer count of basis points, end to end — column types, wire
format, arithmetic. `packages/shared/src/money/` is the only place monetary
arithmetic happens, and `calculation.ts` is the single code path behind the
figure on the invoice, the PDF, the payment page and the Zoho push. The TDD-001
§9.3 worked example is a test fixture and a seeded invoice.

**Tenant isolation is three layers, not one.** The request guard resolves an
immutable scope; repositories scope their queries from it; PostgreSQL row-level
security is the backstop that makes a forgotten predicate return nothing rather
than someone else's data. The runtime connection deliberately uses a non-owner
role, because an owner bypasses RLS. `apps/api/src/modules/*/database/rls.test.ts` proves
all of this against a real database.

One consequence worth knowing before you touch it: `PrismaService.withoutScope`
is the only legitimate way to look something up _before_ a tenant scope is
known — the public payment page resolving a token to a brand, for instance.
It cannot simply skip setting the scope variables on the app's own RLS-bound
connection, because every policy here reads "no scope set" as "deny," not
"allow everything." `withoutScope` runs on a second, owner-role connection
(`DIRECT_DATABASE_URL`) specifically so it bypasses RLS for real rather than
silently returning nothing.

**External systems are reached through ports.** `PaymentGatewayPort`,
`AccountingPort`, `MailPort` and `StoragePort` are owned by the domain;
adapters implement them and are bound in one place. This is why the unverified
Numbers Gateway contract blocks one file instead of the payment workstream.

**No local path reaches a real provider.** Gateway, accounting, mail and storage
all resolve to in-repo fakes or local containers. The environment schema refuses
to boot production with a fake bound.

## Commands

| Command                                                  | Does                               |
| -------------------------------------------------------- | ---------------------------------- |
| `pnpm dev`                                               | All apps and the API in watch mode |
| `pnpm build`                                             | Build everything                   |
| `pnpm test`                                              | Unit and integration tests         |
| `pnpm typecheck`                                         | Type-check every workspace         |
| `pnpm db:bootstrap`                                      | Create module databases and roles  |
| `pnpm db:migrate` / `db:seed` / `db:reset`               | Schemas and fixtures, every module |
| `pnpm db:studio:platform` / `db:studio:invoicing`        | Browse one module's database       |
| `pnpm db:migrate-legacy`                                 | Copy a pre-split database in       |
| `pnpm boot-check`                                        | Platform alone, then + invoicing   |
| `pnpm services:up` / `services:down` / `services:status` | Local dependencies                 |

## Connecting Zoho (partially wired)

`ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` in `.env` are consumed by
`ZohoBooksAdapter`'s OAuth token exchange, which is real and works. What does
**not** exist yet is anything that calls it: there is no
`/integrations/zoho/connect` endpoint and no callback route at
`ZOHO_REDIRECT_URI`, so filling in credentials alone does not connect
anything. Before that flow is built, also confirm:

- **Data center** — `ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` default to the
  US domain (`zoho.com`). If the account lives on `.eu`, `.in`, `.com.au` or
  `.jp`, these need to change or every request will 404 against the wrong
  region.
- **Redirect URI registration** — whatever is registered against this OAuth
  client in the Zoho API Console must match `ZOHO_REDIRECT_URI` exactly,
  including the port. It is not discovered automatically.
- **Organization ID** — connections are per brand (`IntegrationConnection`,
  one row per brand per provider), not a single global org, so there is no
  environment variable for it. The connect flow, once built, is where a brand
  picks which Zoho organization it talks to.

## Known gaps, deliberately left open

These are decisions or dependencies that are not ours to make up:

- **DEP-01 — Numbers Gateway.** The API contract could not be read, so
  `NumbersGatewayAdapter` is a typed placeholder that names the seven questions
  it needs answered. `PAYMENT_GATEWAY_DRIVER=fake` is the working path.
- **Q-01 — card fee base.** The fee is computed on the post-tax total per
  TDD-001 §9.2. Surcharging is also regulated in some US states. Both need a
  client answer before the fee ships.
- **Unit price precision.** TDD-001 §9.3 writes a unit price with three decimal
  places, which `unit_price_minor` cannot hold. The fixture carries the fraction
  on the quantity side, which is arithmetically identical. If fractional _unit
  prices_ are a real requirement, the schema needs a four-decimal price column.
- **Zoho object mapping.** Transport, OAuth refresh and error classification are
  implemented; the field-level mapping, and the connect/callback flow itself,
  are not — see above.
- **Authorisation matrix test.** The matrix and its unit tests exist. The
  generated role × endpoint cross product (NFR-SEC-012) needs endpoints to
  enumerate.
- **Partial payment is not implemented.** Every payment intent targets the
  full remaining balance; `BrandSettings.partialPaymentEnabled` exists in the
  schema but nothing reads it yet.
- **Wallet and check payment are not wired up.** `PaymentMethod` includes
  `WALLET` and `CHECK`, and the domain logic handles them, but only `CARD`
  and `ACH` are offered on the actual payment page.
- **Password lifecycle is not built.** Sign-in, lockout, audit and sign-out
  exist (FR-AUTH-001..004, 010); forgotten-password (FR-AUTH-005/006), change
  password (007), the configurable password policy (008), idle-session expiry
  (009) and two-factor (012/013) do not. `loginSchema` already accepts a
  `totp` field and the `user.totp_secret` column exists; nothing reads either.
