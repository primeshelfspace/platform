# Invoicing module (Sugrpay)

Send invoices and get paid. Owns the **invoicing database**.

## Owns

| Feature          | What it does                                                                        |
| ---------------- | ----------------------------------------------------------------------------------- |
| `customers/`     | Customers and their contact people                                                  |
| `invoices/`      | Drafting, issuing, numbering, sending, cancelling invoices                          |
| `payments/`      | Payment intents, gateway webhooks, settlement                                       |
| `checks/`        | Mailed-check submissions and review                                                 |
| `pay-api/`       | The public payment page's API (token-only access) and invoice PDFs                  |
| `settings/`      | Per-brand invoicing settings: numbering, payment methods, branding, email templates |
| `zoho-sync/`     | Two-way Zoho Books sync: push, pull, webhooks, sandbox, scheduled tick              |
| `dashboard/`     | Totals, trends and attention lists for the admin dashboard                          |
| `platform-sync/` | Keeps invoicing's read-only copy of platform brands current                         |
| `database/`      | The invoicing Prisma client and service; RLS tests                                  |
| `testing/`       | Test-only fixtures (`*.test-support.ts`)                                            |

## Exposes (`public-api.ts`)

The worker's sync jobs: `ZohoSyncService`, `ZohoPullService`,
`ZohoScheduledSyncService`. Nest module for wiring (`modules.ts`):
`InvoicingModule`.

## Listens to

`platform.brand.created`, `platform.brand.updated` → `platform-sync/`.

## Uses from the platform

Authorisation decorators, `BrandsService` (brand colour), `AuditLogService`,
`IntegrationConnectionService` (Zoho credentials, connection status),
`StripeAccountService`.

## Never

Imports another product, or writes the `brand` table (it is the platform's
data, copied here read-only).
