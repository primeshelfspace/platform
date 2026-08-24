/**
 * Row-level security is the backstop layer (TDD-001 §6.1), and a backstop that
 * is never exercised is a comment. These tests talk to a real PostgreSQL with
 * the real policies, as the real non-owner application role.
 *
 * They need a migrated, seeded database. Run:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/load-env.js';

loadEnv();

const appUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DIRECT_DATABASE_URL'] ?? appUrl;

// Skipped rather than failed when no database is configured, so a unit-test-only
// run stays useful. The CI integration stage always provides one.
const describeWithDb = appUrl && ownerUrl ? describe : describe.skip;

describeWithDb('row-level security', () => {
  const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });

  let fenwickId = '';
  let northgateId = '';
  let solsticeId = '';

  beforeAll(async () => {
    // Read the fixtures as the owner: the app role cannot see them yet, which
    // is the point.
    const merchants = await owner.merchant.findMany({ select: { id: true, name: true } });
    fenwickId = merchants.find((m) => m.name.startsWith('Fenwick'))?.id ?? '';
    northgateId = merchants.find((m) => m.name.startsWith('Northgate'))?.id ?? '';

    const brands = await owner.brand.findMany({ select: { id: true, displayName: true } });
    solsticeId = brands.find((b) => b.displayName === 'Solstice Kitchenware')?.id ?? '';

    if (!fenwickId || !northgateId || !solsticeId) {
      throw new Error('seed data missing — run pnpm db:seed');
    }
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), owner.$disconnect()]);
  });

  /** Runs `work` with the given scope applied, the way PrismaService does. */
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
    expect(await app.merchant.count()).toBe(0);
  });

  it('shows every brand in the merchant to an all-brand role', async () => {
    const counts = await withScope(
      { merchantId: fenwickId, allBrands: true, brandIds: [] },
      async (tx) => ({
        brands: await tx.brand.count(),
        invoices: await tx.invoice.count(),
      }),
    );
    expect(counts.brands).toBe(3);
    expect(counts.invoices).toBeGreaterThan(0);
  });

  it('never leaks another merchant to an all-brand role', async () => {
    const leaked = await withScope({ merchantId: fenwickId, allBrands: true, brandIds: [] }, (tx) =>
      tx.merchant.count({ where: { id: northgateId } }),
    );
    expect(leaked).toBe(0);
  });

  it('restricts a brand-scoped role to its assignments', async () => {
    const counts = await withScope(
      { merchantId: fenwickId, allBrands: false, brandIds: [solsticeId] },
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
    // exclusively through its parent customer (app_customer_visible), the
    // same shape line_item/invoice_event already prove above for invoice.
    // Zoho-sourced in practice, but the row here is created directly so
    // this test doesn't depend on ever having run a real pull.
    const customer = await owner.customer.findFirst({ where: { brandId: solsticeId } });
    if (!customer) throw new Error('seed data missing a Solstice customer — run pnpm db:seed');
    const person = await owner.customerContactPerson.create({
      data: { customerId: customer.id, firstName: 'RLS Test Contact' },
    });

    const visible = await withScope(
      { merchantId: fenwickId, allBrands: false, brandIds: [solsticeId] },
      (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
    );
    expect(visible).toBe(1);

    const wrongBrand = await withScope(
      { merchantId: fenwickId, allBrands: false, brandIds: [] },
      (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
    );
    expect(wrongBrand).toBe(0);

    // Even an all-brand role gets nothing: app_brand_visible requires the
    // brand to belong to the *caller's* merchant, and Solstice is Fenwick's.
    const wrongMerchant = await withScope(
      { merchantId: northgateId, allBrands: true, brandIds: [] },
      (tx) => tx.customerContactPerson.count({ where: { id: person.id } }),
    );
    expect(wrongMerchant).toBe(0);
  });

  it('denies the application role any update on the audit log', async () => {
    // Append-only is a grant, not a convention (TDD-001 §5.2).
    await expect(app.$executeRawUnsafe(`UPDATE audit_log SET action = 'tampered'`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});
