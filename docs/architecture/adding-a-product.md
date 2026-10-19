# Adding a product (HQ)

HQ already has placeholders: `apps/api/src/modules/hq/` and `apps/hq/`. Bringing
it (or any later product) online follows the same steps invoicing did.

## Backend

1. **Database.** Add `prisma/hq/schema.prisma` (generator output
   `../../generated/hq`, datasource `HQ_DATABASE_URL` / `HQ_DIRECT_DATABASE_URL`),
   an init migration, and an `rls_and_grants` migration modelled on
   `prisma/invoicing/migrations/*_rls_and_grants`. Add `'HQ'` to `MODULES` in
   `prisma/bootstrap.ts`, the two URLs to `.env.example`, `shared/config/env.ts`
   and the schema to the `db:*` scripts in `apps/api/package.json`.
2. **Module skeleton.** Create `modules/hq/` with `database/` (copy
   invoicing's `client.ts`, `*-prisma.service.ts`, `*-database.module.ts`),
   `hq.module.ts`, `modules.ts`, `public-api.ts` and `README.md`.
3. **Gate it.** Put `@ProductScope('HQ')` on every HQ controller (the
   coverage test fails without it), so only subscribed companies and users
   with an HQ role get in — see [products-and-access.md](products-and-access.md).
   When HQ needs its own permission matrix, map its roles in `productScope`
   (`tenancy/interface/authorisation.ts`).
4. **Register it.** Add `'hq'` to the `ENABLED_PRODUCTS` enum
   (`shared/config/env.ts`) and to `PRODUCTS` in `app.module.ts`; add `hq` to
   `PRODUCTS` in `module-boundaries.test.ts`; add
   `node scripts/boot-check.mjs hq` to the root `boot-check` script.
5. **Platform data it needs.** Subscribe to platform events (copy
   `modules/invoicing/platform-sync/`) for any platform data HQ must join to,
   such as brands and locations. Ask the platform's `public-api.ts` for
   everything else.
6. **Features.** Build each feature in the layers described in
   [layers.md](layers.md).
7. **Working with invoicing.** Never import it. Listen to its events
   (`invoicing.invoice.issued`, …) and expose HQ's own reads (`HqCatalogApi`)
   through `modules/hq/public-api.ts` for invoicing to ask.

## Frontend

`apps/hq` becomes a Next.js app modelled on `apps/invoicing` (its own port in
`.env`, the shared `@platform/ui` and `@platform/kernel` packages, plus `@platform/hq-contracts`).
Copy invoicing's `middleware.ts` and `lib/session.ts`: sign-in stays in
Accounts and the session cookie is shared. Set `NEXT_PUBLIC_HQ_URL` so the
Accounts launcher can open it, and add `hq` to `deploy/deploy.sh` and
`deploy/ecosystem.config.cjs`.

## Done when

HQ runs with only the platform beside it (`node scripts/boot-check.mjs hq`),
and switching HQ off leaves invoicing working.
