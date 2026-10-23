/**
 * One-off, safe to re-run: copies each brand's Zoho Books connection from the
 * platform database (integration_connection, provider ZOHO_BOOKS) into
 * Sugrpay's own zoho_connection table — the data half of moving Zoho sync
 * into the Sugrpay API. Rows already present in Sugrpay are left as they are,
 * unless the platform's copy is newer. Credentials are copied still encrypted
 * (both APIs use the same CREDENTIAL_ENCRYPTION_KEY).
 *
 *   pnpm db:move-zoho-connections
 */
import { PrismaClient as InvoicingClient, Prisma } from '../../apps/sugrpay/generated/index.js';
import { PrismaClient as PlatformClient } from '../../apps/platform/generated/index.js';

const platform = new PlatformClient({
  datasources: {
    db: {
      url: process.env['PLATFORM_DIRECT_DATABASE_URL'] ?? process.env['PLATFORM_DATABASE_URL'],
    },
  },
});
const invoicing = new InvoicingClient({
  datasources: {
    db: {
      url: process.env['INVOICING_DIRECT_DATABASE_URL'] ?? process.env['INVOICING_DATABASE_URL'],
    },
  },
});

async function main(): Promise<void> {
  const rows = await platform.integrationConnection.findMany({ where: { provider: 'ZOHO_BOOKS' } });
  let copied = 0;
  let skipped = 0;
  for (const row of rows) {
    const brandExists = await invoicing.brand.findUnique({ where: { id: row.brandId } });
    if (!brandExists) {
      console.warn(`skipping brand ${row.brandId}: not in Sugrpay's brand copy`);
      skipped++;
      continue;
    }
    const existing = await invoicing.zohoConnection.findUnique({ where: { brandId: row.brandId } });
    if (existing && existing.updatedAt >= row.updatedAt) {
      skipped++;
      continue;
    }
    const data = {
      status: row.status,
      encryptedCredentials: row.encryptedCredentials,
      config: row.config ?? Prisma.DbNull,
      lastSyncAt: row.lastSyncAt,
      lastPulledAt: row.lastPulledAt,
      health: row.health,
      pullFrequencyMinutes: row.pullFrequencyMinutes,
      customerSyncEnabled: row.customerSyncEnabled,
      invoiceSyncEnabled: row.invoiceSyncEnabled,
    };
    await invoicing.zohoConnection.upsert({
      where: { brandId: row.brandId },
      create: { brandId: row.brandId, ...data },
      update: data,
    });
    copied++;
  }
  console.log(`Zoho connections: ${copied} copied, ${skipped} skipped, ${rows.length} found.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([platform.$disconnect(), invoicing.$disconnect()]));
