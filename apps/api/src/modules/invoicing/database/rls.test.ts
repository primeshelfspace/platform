/**
 * Row-level security in the invoicing database (TDD-001 §6.1), against the
 * real policies, as the real non-owner application role (invoicing_app).
 *
 * The scope is the platform's (merchant + brands from the session); the
 * checks run against invoicing's read-only copy of the brands. The platform
 * database's own tables are proved in platform/tenancy/rls.test.ts.
 *
 * They need migrated, seeded databases. Run:
 *   pnpm setup:local && pnpm --filter @platform/api test
 */
import { PrismaClient } from './client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../../shared/config/load-env.js';

loadEnv();

const appUrl = process.env['INVOICING_DATABASE_URL'];
const ownerUrl = process.env['INVOICING_DIRECT_DATABASE_URL'] ?? appUrl;
const platformUrl = process.env['PLATFORM_DATABASE_URL'];

const describeWithDb = appUrl && ownerUrl ? describe : describe.skip;

describeWithDb('row-level security (invoicing database)', () => {
  const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });

  let sugrpayId = '';
  let northgateId = '';
  let solsticeId = '';

  beforeAll(async () => {
    // The brand copy carries each brand's merchant id, so the fixtures are
    // found without touching the platform database.
    const brands = await owner.brand.findMany({
      select: { id: true, displayName: true, merchantId: true },
    });
    const solstice = brands.find((b) => b.displayName === 'Solstice Kitchenware');
    const northgate = brands.find((b) => b.displayName === 'Northgate');
    solsticeId = solstice?.id ?? '';
    sugrpayId = solstice?.merchantId ?? '';
    northgateId = northgate?.merchantId ?? '';

    if (!sugrpayId || !northgateId || !solsticeId) {
      throw new Error('seed data missing — run pnpm db:seed');
    }
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), owner.$disconnect()]);
  });

  /** Runs `work` with the given scope applied, the way InvoicingPrismaService does. */
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
    expect(await app.invoice.count()).toBe(0);
    expect(await app.brand.count()).toBe(0);
    expect(await app.customer.count()).toBe(0);
    expect(await app.brandSettings.count()).toBe(0);
  });

  it('shows every brand in the merchant to an all-brand role', async () => {
    const counts = await withScope(
      { merchantId: sugrpayId, allBrands: true, brandIds: [] },
      async (tx) => ({
        brands: await tx.brand.count(),
        invoices: await tx.invoice.count(),
      }),
    );
    expect(counts.brands).toBe(3);
    expect(counts.invoices).toBeGreaterThan(0);
  });

  it('restricts a brand-scoped role to its assignments', async () => {
    const counts = await withScope(
      { merchantId: sugrpayId, allBrands: false, brandIds: [solsticeId] },
      async (tx) => ({
        brands: await tx.brand.count(),
        invoices: await tx.invoice.count(),
        lineItems: await tx.lineItem.count(),
      }),
    );
    expect(counts.brands).toBe(1);
    expect(counts.invoices).toBeGreaterThan(0);
    // line_item carries no brand_id; it is reached through its invoice.
    expect(counts.lineItems).toBeGreaterThan(0);
  });

  it('refuses a brand id from another merchant even when named explicitly', async () => {
    // The probe an attacker actually runs: a valid session, someone else's id.
    const visible = await withScope(
      { merchantId: northgateId, allBrands: false, brandIds: [solsticeId] },
      (tx) => tx.invoice.count(),
    );
    expect(visible).toBe(0);
  });

  it('holds child tables to the same scope as their parent invoice', async () => {
    const events = await withScope(
      { merchantId: northgateId, allBrands: false, brandIds: [solsticeId] },
      (tx) => tx.invoiceEvent.count(),
    );
    expect(events).toBe(0);
  });

  it('holds customer_contact_person to the same scope as its parent customer', async () => {
    // customer_contact_person carries no brand_id of its own — reached
    // exclusively through its parent customer (app_customer_visible).
    const customer = await owner.customer.findFirst({ where: { brandId: solsticeId } });
    if (!customer) throw new Error('seed data missing a Solstice customer — run pnpm db:seed');
    const person = await owner.customerContactPerson.create({
      data: { customerId: customer.id, firstName: 'RLS Test Contact' },
    });

    try {
      const visible = await withScope(
        { merchantId: sugrpayId, allBrands: false, brandIds: [solsticeId] },
        (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
      );
      expect(visible).toBe(1);

      const wrongBrand = await withScope(
        { merchantId: sugrpayId, allBrands: false, brandIds: [] },
        (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
      );
      expect(wrongBrand).toBe(0);

      // Even an all-brand role gets nothing: app_brand_visible requires the
      // brand to belong to the *caller's* merchant, and Solstice is Sugrpay's.
      const wrongMerchant = await withScope(
        { merchantId: northgateId, allBrands: true, brandIds: [] },
        (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
      );
      expect(wrongMerchant).toBe(0);
    } finally {
      await owner.customerContactPerson.delete({ where: { id: person.id } });
    }
  });

  it('keeps the brand copy read-only for the application role', async () => {
    // Brands belong to the platform; only the event projector (owner) writes
    // invoicing's copy.
    await expect(
      withScope({ merchantId: sugrpayId, allBrands: true, brandIds: [] }, (tx) =>
        tx.$executeRawUnsafe(`UPDATE brand SET display_name = 'tampered'`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it.skipIf(!platformUrl)('cannot connect to another module’s database at all', async () => {
    // One database per module: invoicing_app holds no CONNECT on the platform's.
    const url = new URL(platformUrl!);
    const invoicingRole = new URL(appUrl!);
    url.username = invoicingRole.username;
    url.password = invoicingRole.password;
    const intruder = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await expect(intruder.$queryRawUnsafe('SELECT 1')).rejects.toThrow(/permission denied|denied/i);
    await intruder.$disconnect().catch(() => undefined);
  });
});
