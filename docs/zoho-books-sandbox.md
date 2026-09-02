# Zoho Books Sandbox

This document covers the Zoho Books **Sandbox API** integration: config-testing
(custom functions, workflows, fields) on a brand's already-connected Zoho
Books organization, before pushing validated changes back to that same
production org.

It does **not** cover the base Zoho Books OAuth integration (customer/invoice/
payment sync) — that already exists and is unaffected by anything here. See
`ZohoConnectController` / `ZohoBooksAdapter` for that.

## What "Sandbox" actually is (and isn't)

Per the official docs (<https://www.zoho.com/books/api/v3/sandbox/>), Zoho
Books Sandbox is **not** a parallel test environment with its own
credentials, the way Stripe or Square "test mode" works. It is a feature of
an **already-connected production organization**: you create a sandbox copy
of that org, test configuration changes against the copy, then push the
validated changes back into the same production org.

Practically, this means:

- Sandbox calls reuse the **same OAuth client, same access/refresh token,
  same `organization_id`** as the rest of the Zoho Books integration. There
  is no separate sandbox login, no separate app registration, and no
  separate base URL to switch between "sandbox mode" and "production mode."
- There is nothing to "migrate from sandbox to production" at the
  application-config level — a brand connects to Zoho once, and sandbox
  management becomes available for that same connection.
- Zoho marks this API as an **early-access capability**. It may not appear
  at all for a given Zoho Books account/edition until Zoho enables it — see
  the manual step below.

## Manual step required (cannot be done from this codebase)

Before any of this will work against a real Zoho org:

1. Log into the Zoho Books organization the brand is (or will be) connected
   to → **Settings** → look for a **Sandbox** section.
2. If it isn't there, your account/edition doesn't have early access yet —
   contact Zoho support or your account manager to request it.
3. No new OAuth application or client credentials are needed. The existing
   connect flow (`ZohoConnectController`) already requests
   `ZohoBooks.fullaccess.all`, which is expected to cover the
   `ZohoBooks.settings.*` scopes the Sandbox API requires. If a sandbox call
   ever fails with a scope/permission error, the fix is to reconnect that
   brand (Brand Settings → Integrations → Zoho Books → Disconnect, then
   Connect again) — not to create anything new in the Zoho Developer
   Console.

## Environment variables

None. Sandbox reuses the existing Zoho environment configuration:

| Variable                                   | Purpose                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`    | The platform's one registered Zoho OAuth app.             |
| `ZOHO_REDIRECT_URI`                        | Already configured for the base OAuth connect flow.       |
| `ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` | Zoho's OAuth and API hosts for the account's data center. |

A brand's sandbox id and status are **not** environment configuration — they
are per-brand, discovered at runtime from Zoho (`GET /books/v3/sandboxes`),
the same way `organization_id` already is. A single global
`ZOHO_BOOKS_SANDBOX_ID`-style variable would be wrong here: this app is
multi-brand, and each brand's Zoho org can have its own sandbox(es).

## OAuth scopes

`ZohoBooks.settings.CREATE` / `READ` / `UPDATE` / `DELETE` — the same
`settings.*` family already implied by the `ZohoBooks.fullaccess.all` scope
requested at connect time. No new scope request is made.

## API surface added

All routes are brand-scoped, authenticated, and gated by the same
`INTEGRATIONS` permission (Brand Admin and above) that already protects
Zoho connect/disconnect/settings:

```
GET    /brands/:brandId/integrations/zoho/sandboxes
POST   /brands/:brandId/integrations/zoho/sandboxes
GET    /brands/:brandId/integrations/zoho/sandboxes/:sandboxId
PATCH  /brands/:brandId/integrations/zoho/sandboxes/:sandboxId
DELETE /brands/:brandId/integrations/zoho/sandboxes/:sandboxId
PATCH  /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/activation
POST   /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/rebuild
GET    /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/changes?target=sandbox|production
PATCH  /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/changes/:changeId
POST   /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/push/validate
POST   /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/push
GET    /brands/:brandId/integrations/zoho/sandboxes/logs/deployments
```

`POST .../push` is the only route that can change the brand's live production
Zoho org. It requires `{ "confirm": true }` in the body
(`zohoSandboxPushConfirmSchema`) — nothing else in the codebase (no cron, no
queue worker) ever calls it, and the admin UI only reaches it from behind a
two-step Validate → confirm dialog.

## Using it

In Brand Settings → Integrations → Zoho Books (a brand must already be
connected), a **Sandbox** section lets you create/list/activate/deactivate/
rebuild/delete sandboxes, view pending changes, and run the Validate → Push
to Production flow.

If Sandbox isn't enabled for the org yet, the section shows Zoho's own error
inline rather than failing the rest of the Integrations tab.

## Verifying you're actually hitting the right org

Sandbox calls always target the **same** `organization_id` as the rest of
that brand's Zoho integration — there's no separate sandbox endpoint to
misconfigure. To confirm the platform is really talking to the org you
expect, compare the **Organization** name shown at the top of the Zoho Books
detail panel (from `GET /organizations`) against the org you see in Zoho's
own UI, and check the sandbox names/ids listed here against Zoho Books →
Settings → Sandbox in that same org.

## Testing

`apps/api/src/integrations/zoho-sandbox.service.test.ts` covers the request
shapes (paths, methods, bodies) for every operation, the not-connected error
path, and that a Zoho `IntegrationError` (e.g. a scope/permission failure)
propagates untouched rather than being swallowed. These are unit tests
against a mocked HTTP layer — they do not call the real Zoho API. End-to-end
verification against a live Zoho Books org with Sandbox enabled is the
remaining manual step once access is confirmed (see above).
