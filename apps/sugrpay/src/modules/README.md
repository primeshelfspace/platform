# Sugrpay API (invoicing)

Send invoices and get paid: package `@platform/sugrpay-api`, port 4002,
`sugrpay-api.sugrpay.com`. Owns the **invoicing database** (schema in
`apps/sugrpay/prisma/schema.prisma`). Its background worker is
`apps/sugrpay/src/worker.ts`.

## Owns

| Feature            | What it does                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers/`       | Customers and their contact people                                                                                                            |
| `invoices/`        | Drafting, issuing, numbering, sending, cancelling invoices                                                                                    |
| `payments/`        | Payment intents, gateway webhooks, settlement                                                                                                 |
| `checks/`          | Mailed-check submissions and review                                                                                                           |
| `pay-api/`         | The public payment page's API (token-only access) and invoice PDFs                                                                            |
| `settings/`        | Per-brand invoicing settings: numbering, payment methods, branding, email templates                                                           |
| `zoho-sync/`       | Zoho Books: the connection (`ZohoConnectionService`, `zoho_connection` table) and two-way sync: push, pull, webhooks, sandbox, scheduled tick |
| `dashboard/`       | Totals, trends and attention lists for the admin dashboard                                                                                    |
| `platform-sync/`   | Keeps Sugrpay's read-only copy of platform brands current                                                                                     |
| `platform-access/` | The only way to reach the platform (see below), and `POST /internal/events`                                                                   |
| `database/`        | The invoicing Prisma client and service; RLS tests                                                                                            |
| `testing/`         | Test-only fixtures (`*.test-support.ts`)                                                                                                      |

Outside `modules/`: `adapters/` (payment gateway: fake, Stripe, Numbers;
accounting: fake, Zoho Books), `infra/queue/` (BullMQ queues), `health/`
(queue depths) and `routes/` (the route-coverage test).

## Reaches the platform (`platform-access/`)

Only over HTTP, through `PlatformApiClient`, which calls the platform's
`/internal/...` routes at `PLATFORM_INTERNAL_URL` with `INTERNAL_API_KEY`:

- `RemoteScopeResolver` — the request guard's session lookup
  (`POST /internal/sessions/resolve`); brand checks use Sugrpay's own brand copy.
- `StripeAccountService` — a brand's Stripe account, and which brand a Stripe
  account belongs to.
- `AuditLogService` — writes audit entries.
- `BrandsService` — sets a brand's colour.
- `SystemScopeResolver` — a scope for work no user started (webhooks,
  scheduled sync), read from Sugrpay's own brand copy.

`modules/public-api.ts` exports the Zoho sync services the worker runs.

## Listens to

Platform events, delivered to `POST /internal/events` by the platform's
`EventForwarder`: `platform.brand.created`, `platform.brand.updated` →
`platform-sync/`. See [docs/architecture/events.md](../../../../docs/architecture/events.md).

## Never

Imports another API's code, or writes the `brand` table (it is the platform's
data, copied here read-only).
