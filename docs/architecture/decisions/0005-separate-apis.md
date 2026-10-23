# 0005 — One API per product

**Status:** accepted · Oct 2026 · supersedes the "one process" part of
[0001](0001-modular-monolith.md)

## Decision

The backend is three separate programs in this one repository, each with its
own folder, address, database and deploy unit:

| API      | Folder          | Address                    | Port | Database    | Serves                                                                               |
| -------- | --------------- | -------------------------- | ---- | ----------- | ------------------------------------------------------------------------------------ |
| platform | `apps/platform` | `platform-api.sugrpay.com` | 4001 | `platform`  | sign-in, companies, brands, locations, users and roles, subscriptions, Stripe/Square |
| Sugrpay  | `apps/sugrpay`  | `sugrpay-api.sugrpay.com`  | 4002 | `invoicing` | customers, invoices, payments, checks, the payment page, brand settings, Zoho Books  |
| HQ       | `apps/hq`       | `hq-api.sugrpay.com`       | 4003 | (none yet)  | nothing yet — a skeleton that starts, answers `/health`, and resolves sessions       |

`api.sugrpay.com` stays as a front door that passes each path to the API that
owns it (`apiServiceFor` in `packages/platform-contracts/src/api-routing.ts`,
mirrored in `deploy/nginx/api.conf`), so links and provider settings that
already point at it keep working.

## How they talk

- **Never through each other's database or code.** A build test
  (`apps/platform/src/module-boundaries.test.ts`) and lint rules fail on any
  import from one app into another.
- **Ask** over HTTP: a product calls the platform's `/internal/...` routes on
  the same machine (`PLATFORM_INTERNAL_URL`), sending the shared
  `INTERNAL_API_KEY`. nginx refuses `/internal/` from the internet. Today
  Sugrpay asks: who a session belongs to (every signed-in request), a brand's
  Stripe account, which brand a Stripe account belongs to, write an audit
  entry, set a brand's colour.
- **Tell** through events: the platform's outbox delivers each event to
  Sugrpay's `POST /internal/events` and retries until it is accepted. Sugrpay
  keeps its own copy of the brands this way, which is also how it answers
  "is this brand one of the caller's company's?" without a call.

Shared building blocks that are not business code live in packages:
`@platform/server` (configuration, the request guard, mail, storage, Redis,
the outbox dispatcher, rate limits, security headers, health),
`@platform/kernel` and the contracts packages.

## What moved

- **Zoho Books connections** moved from the platform's `integration_connection`
  table to Sugrpay's own `zoho_connection` table: Zoho sync is Sugrpay's alone,
  and keeping the 17 calls it makes in-process beats making them network calls.
  `pnpm db:move-zoho-connections` copies existing rows (safe to repeat).
- Background jobs (Zoho sync, scheduled pull) were all Sugrpay's: the worker is
  `apps/sugrpay/src/worker.ts`. The platform runs no worker.
- The end-to-end user journeys (`e2e/`) start both APIs in one test process
  and route each call with `apiServiceFor`, as the web app does.

## Why

The product owner's requirement: each product has its own backend and its own
database, and products never read each other's data — they ask over an API.
The module walls of 0001 already enforced the boundaries inside one program;
this makes them physical, so each API can be deployed, restarted and scaled on
its own.

## Cost

- Every signed-in Sugrpay request makes one internal call to the platform to
  resolve the session (on the same machine: a few milliseconds).
- If the platform API is down, Sugrpay answers 503 for signed-in requests (the
  public payment page keeps working, except card payments, which need the
  brand's Stripe account from the platform).
- Three processes to run and watch instead of one (see
  `deploy/ecosystem.config.cjs`).
