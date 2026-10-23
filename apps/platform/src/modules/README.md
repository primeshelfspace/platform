# Platform API

The shared core every product is built on: package `@platform/platform-api`,
port 4001, `platform-api.sugrpay.com`. Owns the **platform database**
(schema in `apps/platform/prisma/schema.prisma`). Runs no worker.

## Owns

| Feature          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `auth/`          | Sign-in, sessions, lockout, password reset                                  |
| `companies/`     | The tenant (merchant) and its onboarding                                    |
| `brands/`        | Brand identity: names, addresses, currency, colour, logo                    |
| `users/`         | Team members, their roles and brand assignments                             |
| `locations/`     | Stores and warehouses                                                       |
| `subscriptions/` | Which products a company subscribes to                                      |
| `tenancy/`       | Plugs session lookup into the shared request guard; system scopes           |
| `integrations/`  | Stripe, Square and Authorize.net connections and credentials                |
| `audit/`         | The append-only audit log, open to every product                            |
| `events/`        | The platform's transactional outbox (contracts are in `platform-contracts`) |
| `internal/`      | `/internal/...` routes for the other APIs, and the `EventForwarder`         |
| `database/`      | The platform Prisma client and service; RLS tests                           |

## Serves the other APIs (`internal/`)

Routes marked `@InternalOnly()`: they need the shared `INTERNAL_API_KEY`, and
nginx refuses them from the internet.

| Route                                            | For                                                        |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `POST /internal/sessions/resolve`                | Who a session token belongs to (every signed-in request)   |
| `GET /internal/brands/:brandId/stripe-account`   | A brand's connected Stripe account, to take a card payment |
| `GET /internal/stripe-accounts/:accountId/brand` | Which brand a Stripe account belongs to (webhooks)         |
| `POST /internal/brands/:brandId/theme-color`     | Set a brand's colour (Sugrpay's branding screens)          |
| `POST /internal/audit`                           | Write an audit entry                                       |

## Publishes

`platform.brand.created`, `platform.brand.updated`,
`platform.subscription.changed`, `platform.location.created`,
`platform.location.updated`. The `EventForwarder` delivers every one to
Sugrpay's `POST /internal/events` — see
[docs/architecture/events.md](../../../../docs/architecture/events.md).

## Depends on

Only packages (`@platform/server`, `@platform/kernel`,
`@platform/platform-contracts`). The platform never imports another API or a
product's contracts.
