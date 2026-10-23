# HQ API

The API for the HQ product: catalog, stock, purchase orders, receiving,
transfers and sales-channel sync. Package `@platform/hq-api`, port 4003
(`HQ_API_PORT`), `hq-api.sugrpay.com` in production.

Today it is a skeleton: it starts, answers `/health`, and resolves sessions by
asking the platform (`src/platform-access/`, over
`POST /internal/sessions/resolve`). It has no database and no routes of its
own yet. It is already built by `pnpm build`, started by `pnpm dev`, checked by
`pnpm boot-check`, and deployed (pm2 `hq-api`, nginx).

When it is built, it follows the same rules as `apps/sugrpay`: its own
database, its own Prisma client, features in clean-architecture layers under
`src/modules/`, and it talks to other APIs only over HTTP (`/internal/...`
routes) or through events — never by importing their code.

Step-by-step: [docs/architecture/adding-a-product.md](../../docs/architecture/adding-a-product.md).
