# @platform/server

What every backend API shares. Each API (`apps/platform`, `apps/sugrpay`,
`apps/hq`) is its own program with its own database and builds on this
package. It holds only plumbing — never an API's business code or data — and
never imports an app (enforced by `apps/platform/src/module-boundaries.test.ts`
and ESLint). See
[decision 0005](../../docs/architecture/decisions/0005-separate-apis.md).

| Folder         | What it holds                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/`      | The environment schema (`getEnv`, `loadEnv`, `ConfigModule`), validated once at boot. Ports, internal URLs and `INTERNAL_API_KEY` live here too                                                                                                                                      |
| `auth/`        | The request guard and its decorators: `AuthorisationGuard`, `RequirePermission`, `Public`, `ProductScope`, `CurrentScope`. Each API plugs in how sessions are resolved through `ScopeResolver` / `SCOPE_RESOLVER` (the platform reads its database; Sugrpay and HQ ask the platform) |
| `internal/`    | API-to-API calls: `InternalOnly` (marks a route as internal), `InternalKeyGuard` (checks the shared key), `InternalClient` (calls another API's `/internal/...` routes)                                                                                                              |
| `adapters/`    | Mail (SMTP, console) and file storage (local disk, S3). Bound in one place each; the environment chooses which. Local storage (`STORAGE_LOCAL_PATH`) resolves from the repository root, so every API sees the same files                                                             |
| `events/`      | The event bus and the outbox dispatcher                                                                                                                                                                                                                                              |
| `redis/`       | The Redis connection                                                                                                                                                                                                                                                                 |
| `prisma/`      | Scoped-transaction helpers for each API's Prisma service                                                                                                                                                                                                                             |
| `common/`      | Small cross-cutting helpers: rate limits, security headers, OAuth state signing, credential encryption, uploads, concurrency, validation pipe                                                                                                                                        |
| `health/`      | Liveness/readiness endpoints; each API registers its own probes (its database, its queues)                                                                                                                                                                                           |
| `app-setup.ts` | `configureApp`: what every API's `main.ts` applies — body parsers, CORS, proxy trust, security headers                                                                                                                                                                               |

Payment gateway and accounting adapters, and the job queues, are Sugrpay's
alone: they live in `apps/sugrpay/src/adapters/` and `apps/sugrpay/src/infra/queue/`.
