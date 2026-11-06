# Adding a product (HQ)

HQ already has its frame: `apps/hq/` here (package `@platform/hq-api`, port
4003, `hq-api.sugrpay.com`) and `apps/hq` in the sugrpay-frontend repository.
The HQ API already starts, answers `/health`, resolves sessions through the
platform, and is deployed by `deploy/deploy.sh`, pm2 (`hq-api`) and nginx.
Bringing it (or any later product) online means filling in `apps/hq` the way
`apps/sugrpay` is built. See [decisions/0005](decisions/0005-separate-apis.md).

## Backend

1. **Database.** Add `apps/hq/prisma/schema.prisma` (generator output
   `../generated`, datasource `HQ_DATABASE_URL` / `HQ_DIRECT_DATABASE_URL`),
   an init migration, and an `rls_and_grants` migration modelled on
   `apps/sugrpay/prisma/migrations/*_rls_and_grants`. Add `'HQ'` to `MODULES`
   in `scripts/db/bootstrap.ts`, the two URLs to `.env.example`,
   `deploy/.env.production.example` and `packages/server/src/config/env.ts`,
   `db:*` scripts to `apps/hq/package.json`, and HQ to the root `db:*` scripts
   and `deploy/deploy.sh`'s migrations.
2. **Database module.** Create `apps/hq/src/modules/database/` (copy
   Sugrpay's `client.ts`, `*-prisma.service.ts`, `*-database.module.ts`) and an
   `apps/hq/src/modules/README.md`.
3. **Gate it.** Put `@ProductScope('HQ')` on every HQ controller, so only
   subscribed companies and users with an HQ role get in — see
   [products-and-access.md](products-and-access.md). Copy Sugrpay's
   `authorisation-coverage.test.ts` so a route without a declaration fails the
   build. When HQ needs its own permission matrix, map its roles in
   `productScope` (`packages/server/src/auth/authorisation.ts`).
4. **Route it.** Add `'hq'` to `ApiService` and HQ's paths to `apiServiceFor`
   (`packages/platform-contracts/src/api-routing.ts`), and the same paths to the
   `api.sugrpay.com` front door in `deploy/nginx/api.conf`.
5. **Platform data it needs.** Ask the platform's `/internal/...` routes for
   answers needed now (`apps/hq/src/platform-access/` already resolves
   sessions; add routes in `apps/platform/src/modules/internal/` as needed).
   For data HQ must join to, such as brands and locations, keep a copy fed by
   platform events: add an `HQ_INTERNAL_URL` and have the platform's
   `EventForwarder` (`apps/platform/src/modules/internal/event-forwarder.ts`)
   post events to HQ's own `POST /internal/events`, then copy Sugrpay's
   `platform-sync/`. Once HQ has its brand copy, make
   `HqScopeResolver.brandInCompany` read it (today it refuses every brand).
6. **Features.** Build each feature in `apps/hq/src/modules/<feature>/`, in the
   layers described in [layers.md](layers.md).
7. **Working with Sugrpay.** Never import it. Listen to its events
   (`invoicing.invoice.issued`, …, not built yet) and serve HQ's own reads
   over HQ's `/internal/...` routes for Sugrpay to ask.
8. **Health.** Once HQ has a database, have the deploy workflow check
   `localhost:4003/health/ready` instead of `/health/live`.

## Frontend

In the **sugrpay-frontend** repository, `apps/hq` becomes a Next.js app
modelled on `apps/invoicing` (its own port in `.env`, the shared `@platform/ui`
and `@platform/kernel` packages, plus `@platform/hq-contracts`). Copy
invoicing's `middleware.ts` and `lib/session.ts`: sign-in stays in Accounts
and the session cookie is shared. Point it at `https://hq-api.sugrpay.com`.
Set `NEXT_PUBLIC_HQ_URL` so the Accounts launcher can open it, and add `hq` to
that repository's `deploy/deploy.sh` and `deploy/ecosystem.config.cjs`. Copy
`packages/hq-contracts` across the same way as the other contracts.

## Done when

The HQ API starts on its own (`node scripts/boot-check.mjs hq`, part of
`pnpm boot-check`), and stopping it leaves Sugrpay working.
