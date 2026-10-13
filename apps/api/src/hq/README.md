# HQ module

Placeholder for the HQ product module (catalog, stock, purchase orders,
receiving, transfers, channel sync). Nothing is built here yet.

When it is, it follows the same rules as `invoicing/`: its own database, its
own Prisma client, and it talks to other modules only through their
`public-api.ts` or through events.
