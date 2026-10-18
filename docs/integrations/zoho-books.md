# Zoho Books

Sugrpay keeps each brand's customers, invoices and payments in step with that
brand's Zoho Books organisation, in both directions.

| Where                                              | What                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `modules/platform/integrations/`                   | The connection itself: OAuth tokens (encrypted), organisation, health |
| `modules/invoicing/zoho-sync/`                     | What syncs over it: push, pull, webhooks, sandbox, scheduled tick     |
| `shared/adapters/accounting/zoho-books.adapter.ts` | The HTTP client for the Zoho Books API                                |

## Connecting a brand

In the Sugrpay admin: **Brand settings → Integrations → Zoho Books → Connect**.
That calls `GET /brands/:brandId/integrations/zoho/connect`, which sends the
user to Zoho to authorise, and Zoho returns to
`GET /integrations/zoho/callback`.

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

- **Push** (Sugrpay → Zoho): queued on every relevant change, run by the worker.
- **Pull** (Zoho → Sugrpay): driven by Zoho webhooks, plus the **Sync now**
  button; a timed pull every N minutes is off unless
  `ZOHO_SCHEDULED_PULL_ENABLED=true`.
- The worker must be running for push and pull jobs:
  `pnpm --filter @platform/api dev:worker`.

Sync activity (every attempt, with Zoho's own error message) is shown on the
brand's integration panel.

See also [zoho-books-sandbox.md](zoho-books-sandbox.md) for testing against a
Zoho sandbox organisation.
