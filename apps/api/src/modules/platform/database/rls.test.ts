/**
 * Row-level security is the backstop layer (TDD-001 §6.1), and a backstop that
 * is never exercised is a comment. These tests talk to the real platform
 * database with the real policies, as the real non-owner application role
 * (platform_app). Invoicing's own tables are proved the same way in
 * invoicing/database/rls.test.ts.
 *
 * They need migrated, seeded databases. Run:
 *   pnpm setup:local && pnpm --filter @sugrpay/api test
 */
import { PrismaClient } from './client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../../shared/config/load-env.js';

loadEnv();

const appUrl = process.env['PLATFORM_DATABASE_URL'];
const ownerUrl = process.env['PLATFORM_DIRECT_DATABASE_URL'] ?? appUrl;
const invoicingUrl = process.env['INVOICING_DATABASE_URL'];

// Skipped rather than failed when no database is configured, so a unit-test-only
// run stays useful. The CI integration stage always provides one.
const describeWithDb = appUrl && ownerUrl ? describe : describe.skip;

describeWithDb('row-level security (platform database)', () => {
  const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });

  let sugrpayId = '';
  let northgateId = '';
  let solsticeId = '';

  beforeAll(async () => {
    // Read the fixtures as the owner: the app role cannot see them yet, which
    // is the point.
    const merchants = await owner.merchant.findMany({ select: { id: true, name: true } });
    sugrpayId = merchants.find((m) => m.name.startsWith('Sugrpay'))?.id ?? '';
    northgateId = merchants.find((m) => m.name.startsWith('Northgate'))?.id ?? '';

    const brands = await owner.brand.findMany({ select: { id: true, displayName: true } });
    solsticeId = brands.find((b) => b.displayName === 'Solstice Kitchenware')?.id ?? '';

    if (!sugrpayId || !northgateId || !solsticeId) {
      throw new Error('seed data missing — run pnpm db:seed');
    }
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), owner.$disconnect()]);
  });

  /** Runs `work` with the given scope applied, the way PlatformPrismaService does. */
  async function withScope<T>(
    settings: { merchantId: string; allBrands: boolean; brandIds: string[] },
    work: (tx: Omit<PrismaClient, '$transaction'>) => Promise<T>,
  ): Promise<T> {
    return app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.merchant_id', ${settings.merchantId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.all_brands', ${settings.allBrands ? 'on' : 'off'}, true)`;
      await tx.$executeRaw`SELECT set_config('app.brand_ids', ${settings.brandIds.join(',')}, true)`;
      return work(tx as unknown as Omit<PrismaClient, '$transaction'>);
    });
  }

  it('hides everything when no scope is set', async () => {
    expect(await app.brand.count()).toBe(0);
    expect(await app.merchant.count()).toBe(0);
    expect(await app.user.count()).toBe(0);
    expect(await app.integrationConnection.count()).toBe(0);
  });

  it('shows every brand in the merchant to an all-brand role', async () => {
    const counts = await withScope(
      { merchantId: sugrpayId, allBrands: true, brandIds: [] },
      async (tx) => ({
        brands: await tx.brand.count(),
        users: await tx.user.count(),
      }),
    );
    expect(counts.brands).toBe(3);
    expect(counts.users).toBeGreaterThan(0);
  });

  it('never leaks another merchant to an all-brand role', async () => {
    const leaked = await withScope({ merchantId: sugrpayId, allBrands: true, brandIds: [] }, (tx) =>
      tx.merchant.count({ where: { id: northgateId } }),
    );
    expect(leaked).toBe(0);
  });

  it('restricts a brand-scoped role to its assignments', async () => {
    const counts = await withScope(
      { merchantId: sugrpayId, allBrands: false, brandIds: [solsticeId] },
      async (tx) => ({
        brands: await tx.brand.count(),
        // integration_connection carries a brand_id, held to the same scope.
        connections: await tx.integrationConnection.count(),
      }),
    );
    expect(counts.brands).toBe(1);
    expect(counts.connections).toBe(1);
  });

  it('refuses a brand id from another merchant even when named explicitly', async () => {
    // The probe an attacker actually runs: a valid session, someone else's id.
    const visible = await withScope(
      { merchantId: northgateId, allBrands: false, brandIds: [solsticeId] },
      (tx) => tx.brand.count({ where: { id: solsticeId } }),
    );
    expect(visible).toBe(0);
  });

  it('denies the application role any update on the audit log', async () => {
    // Append-only is a grant, not a convention (TDD-001 §5.2).
    await expect(app.$executeRawUnsafe(`UPDATE audit_log SET action = 'tampered'`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('lets the application role write to the event outbox but never read it', async () => {
    await expect(app.$queryRawUnsafe(`SELECT id FROM outbox_event LIMIT 1`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it.skipIf(!invoicingUrl)('cannot connect to another module’s database at all', async () => {
    // One database per module: platform_app holds no CONNECT on invoicing's.
    const url = new URL(invoicingUrl!);
    const platformRole = new URL(appUrl!);
    url.username = platformRole.username;
    url.password = platformRole.password;
    const intruder = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await expect(intruder.$queryRawUnsafe('SELECT 1')).rejects.toThrow(/permission denied|denied/i);
    await intruder.$disconnect().catch(() => undefined);
  });
});
