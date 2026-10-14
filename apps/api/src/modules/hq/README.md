# HQ module

Placeholder for the HQ product: catalog, stock, purchase orders, receiving,
transfers and sales-channel sync. Nothing is built here yet.

When it is, it follows the same rules as `invoicing/`: its own database, its
own Prisma client, features in clean-architecture layers, and it talks to
other modules only through their `public-api.ts` or through events.

Step-by-step: [docs/architecture/adding-a-product.md](../../../../../docs/architecture/adding-a-product.md).
