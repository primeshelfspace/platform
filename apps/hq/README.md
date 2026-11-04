# HQ API

The API for the HQ product: stores and warehouses, catalog, stock, purchasing,
transfers and sales-channel sync (built from HQ's stories). Package
`@platform/hq-api`, port 4003 (`HQ_API_PORT`), `hq-api.sugrpay.com` in
production.

## How it fits

Three APIs, three databases, like Sugrpay:

| API          | Database                  | Holds                                                               |
| ------------ | ------------------------- | ------------------------------------------------------------------- |
| **Platform** | `platform`                | What every product shares: companies, users, roles, brands, sign-in |
| **Sugrpay**  | `invoicing`               | Sugrpay's own data (customers, invoices, payments)                  |
| **HQ**       | `hq` (its own RDS server) | HQ's own data, plus a read-only copy of the brands                  |

- **Common data stays on the platform.** HQ asks the platform for it over HTTP. Sessions come from `/internal/sessions/resolve`. The HQ web app calls the product APIs (Product Session, Company Profile, Brands, Users, Roles) with its JWT; see [/hq/docs](https://api.sugrpay.com/hq/docs).
- **What HQ must join to, it copies.** Today that's the brands. The platform forwards its events to HQ's `POST /internal/events` (when `HQ_INTERNAL_URL` is set), and `platform-sync/` keeps the `brand` table current. Row-level security in HQ's database scopes by that copy.
- **HQ never reads another API's database**, and none reads HQ's.

## Layout

- `prisma/schema.prisma`, `prisma/migrations/`: HQ's database. `init` creates the tables; `rls_and_grants` adds row-level security and the `hq_app` / `hq_owner` grants. The pattern is Sugrpay's.
- `src/modules/database/`: `HqPrismaService`, with `withScope` (scoped, `hq_app`) and `ownerClient` (event handlers). It also registers the `postgres:hq` health check.
- `src/modules/platform-sync/`: the brand copy (`BrandReplicaProjector`, `applyBrandSnapshot`).
- `src/platform-access/`: who is signed in (asked of the platform), the brand check (read from the copy), and the event receiver.
- New features go in `src/modules/<feature>/`, each controller with `@ProductScope('HQ')`.

## Running it

- **Locally:** `pnpm db:bootstrap`, then `pnpm --filter @platform/hq-api db:migrate`, then `pnpm --filter @platform/hq-api dev`. It needs `HQ_DATABASE_URL` and `HQ_DIRECT_DATABASE_URL` in `.env` (see `.env.example`), and refuses to start without `HQ_DATABASE_URL`.
- **Production:** run [deploy/production/add-hq-database.sh](../../deploy/production/add-hq-database.sh) once with the HQ RDS endpoint. It writes the settings, creates the database and logins (asking for the master password, which it never stores), creates the tables, and fills the brand copy. After that, `deploy/deploy.sh` migrates HQ on every deploy.
- **Tests:** `pnpm --filter @platform/hq-api test`.

Step-by-step guide for later pieces: [docs/architecture/adding-a-product.md](../../docs/architecture/adding-a-product.md).
