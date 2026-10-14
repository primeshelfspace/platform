# Platform module

The shared core every product is built on. Owns the **platform database**.

## Owns

| Feature         | What it does                                                             |
| --------------- | ------------------------------------------------------------------------ |
| `auth/`         | Sign-in, sessions, lockout, password reset                               |
| `companies/`    | The tenant (merchant) and its onboarding                                 |
| `brands/`       | Brand identity: names, addresses, currency, colour, logo                 |
| `users/`        | Team members and their brand assignments                                 |
| `tenancy/`      | The request guard, permission decorators, system scopes                  |
| `integrations/` | Connection records and credentials (Zoho, Stripe, Square, Authorize.net) |
| `audit/`        | The append-only audit log, open to every product                         |
| `events/`       | Event contracts and the platform's transactional outbox                  |
| `database/`     | The platform Prisma client and service; RLS tests                        |

## Exposes (`public-api.ts`)

- Authorisation: `AuthorisationGuard`, `CurrentScope`, `Public`, `RequirePermission`
- `SystemScopeResolver` — a tenant scope for background work
- `BrandsService` — products change brand fields through it (e.g. `setThemeColor`)
- `AuditLogService` — products record audit entries through it
- `IntegrationConnectionService`, `StripeAccountService`, OAuth state helpers
- Event contracts: `PLATFORM_EVENTS`, `BrandSnapshot`, `BrandEventPayload`

Nest modules for wiring (`modules.ts`): `PlatformModule`, `BrandsModule`,
`IntegrationsModule`, `AuditModule`.

## Publishes

`platform.brand.created`, `platform.brand.updated` — see
[docs/architecture/events.md](../../../../../docs/architecture/events.md).

## Depends on

Nothing but `shared/`. The platform never imports a product.
