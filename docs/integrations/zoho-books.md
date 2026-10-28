# Zoho Books

Sugrpay keeps each brand's customers, invoices and payments in step with that
brand's Zoho Books organisation, in both directions. All of it lives in the
Sugrpay API (`apps/sugrpay`).

| Where                                                                       | What                                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/sugrpay/src/modules/zoho-sync/application/zoho-connection.service.ts` | The connection itself (`ZohoConnectionService`): OAuth tokens (encrypted), organisation, health |
| `apps/sugrpay/src/modules/zoho-sync/`                                       | What syncs over it: push, pull, webhooks, sandbox, scheduled tick                               |
| `apps/sugrpay/src/adapters/accounting/zoho-books.adapter.ts`                | The HTTP client for the Zoho Books API                                                          |

Connections are stored in Sugrpay's own `zoho_connection` table. Before the
APIs were split they were rows in the platform's `integration_connection`
table; `pnpm db:move-zoho-connections` copies them across (safe to repeat).

## Connecting a brand

In the Sugrpay admin: **Brand settings → Integrations → Zoho Books → Connect**.
That calls `GET /brands/:brandId/integrations/zoho/connect`, which sends the
user to Zoho to authorise, and Zoho returns to
`GET /integrations/zoho/callback`. Both are Sugrpay API routes (locally port
4002; in production through `api.sugrpay.com`, which passes them on).

Set in `.env`:

| Variable                                   | Value                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTING_DRIVER`                        | `zoho` (default `fake` keeps everything local)                                                                                |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`    | From a _Server-based Application_ in the Zoho API Console                                                                     |
| `ZOHO_REDIRECT_URI`                        | Must match the redirect URI registered in the Zoho API Console **exactly**, port included                                     |
| `ZOHO_API_DOMAIN` / `ZOHO_ACCOUNTS_DOMAIN` | Default to the US data centre (`zoho.com`). Change them for `.eu`, `.in`, `.com.au` or `.jp` accounts, or every request fails |
| `ZOHO_WEBHOOK_SECRET`                      | Optional; the shared token Zoho webhooks must carry                                                                           |

Connections are **per brand** (one per brand and provider), so there is no
global organisation id in `.env` — each brand picks its organisation when it
connects.

## How sync runs

- **Push** (Sugrpay → Zoho): queued on every relevant change, run by Sugrpay's
  worker.
- **Pull** (Zoho → Sugrpay): driven by Zoho webhooks, plus the **Sync now**
  button; a timed pull every N minutes is off unless
  `ZOHO_SCHEDULED_PULL_ENABLED=true`.
- **On connect**, one job imports what Zoho already has, then pushes what
  existed here before. The import reads only Zoho's two lists, contacts then
  invoices (one call per 200 records), with no call per record. A contact's
  addresses and contact persons, which the list doesn't carry, are fetched the
  first time the customer (or one of its invoices) is opened; an invoice's
  line items likewise. The access token from connecting is reused, and only
  one job per brand refreshes it at a time.
- The worker must be running for push and pull jobs:
  `pnpm --filter @platform/sugrpay-api dev:worker`.

Sync activity (every attempt, with Zoho's own error message) is shown on the
brand's integration panel.

See also [zoho-books-sandbox.md](zoho-books-sandbox.md) for testing against a
Zoho sandbox organisation.
