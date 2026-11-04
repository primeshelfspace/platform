/**
 * DashboardService against a real database (same convention as
 * InvoicesService — see its own test file for why: needs a migrated,
 * seeded database:
 *   pnpm setup:local && pnpm --filter @platform/api test
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '../../database/client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestScope } from '@platform/kernel';
import { loadEnv } from '@platform/server';
import { getEnv } from '@platform/server';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import type { QueueService } from '../../../infra/queue/queue.service.js';
import { type ZohoConnectionService } from '../../zoho-sync/application/zoho-connection.service.js';
import {
  createInvoicingBrand,
  deleteInvoicingBrand,
} from '../../testing/brand-fixture.test-support.js';
import { bucketFor, DashboardService, trendBuckets } from './dashboard.service.js';

/** Records what retrySyncJob actually asked the queue to do, rather than
 * either running it for real (BullMQ/Redis) or silently no-opping like
 * fake-queue.service.ts — that one exists to make certain writes
 * structurally impossible; retrying an already-inert SyncJob row triggers no
 * such live side effect, and this test needs to see the enqueue call. */
function createRecordingQueueService(): QueueService & {
  enqueued: { queue: string; jobName: string; payload: Record<string, unknown> }[];
} {
  const enqueued: { queue: string; jobName: string; payload: Record<string, unknown> }[] = [];
  return {
    enqueued,
    enqueue: async (queue: string, jobName: string, payload: Record<string, unknown>) => {
      enqueued.push({ queue, jobName, payload });
      return 'fake-job-id';
    },
  } as unknown as QueueService & { enqueued: typeof enqueued };
}

loadEnv();
const hasDb = Boolean(process.env['INVOICING_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describe('trendBuckets: the charts follow the date filter', () => {
  const now = new Date('2026-11-04T15:00:00Z');
  const period = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

  it('gives one point per day for a month, up to today', () => {
    const thisMonth = trendBuckets(period('2026-11-01', '2026-12-01'), now);
    expect(thisMonth.granularity).toBe('day');
    expect(thisMonth.buckets.map((b) => b.key)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    const lastMonth = trendBuckets(period('2026-10-01', '2026-11-01'), now);
    expect(lastMonth.buckets).toHaveLength(31);
    expect(lastMonth.buckets[0]!.label).toBe('Oct 1');
  });

  it('gives one point per week for a quarter, and per month for a year', () => {
    const quarter = trendBuckets(period('2026-10-01', '2027-01-01'), now);
    expect(quarter.granularity).toBe('week');
    expect(quarter.buckets.map((b) => b.key)).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
    const lastQuarter = trendBuckets(period('2026-07-01', '2026-10-01'), now);
    expect(lastQuarter.buckets).toHaveLength(14);
    expect(lastQuarter.buckets.at(-1)!.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    const year = trendBuckets(period('2026-01-01', '2027-01-01'), now);
    expect(year.granularity).toBe('month');
    expect(year.buckets.map((b) => b.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
    ]);
  });

  it('keeps the last six months when no period is given', () => {
    const none = trendBuckets(undefined, now);
    expect(none.buckets.map((b) => b.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  });
});

describe('bucketFor', () => {
  it('promotes overdue over every other status', () => {
    expect(bucketFor('SENT', true)).toBe('Overdue');
    expect(bucketFor('PARTIALLY_PAID', true)).toBe('Overdue');
    expect(bucketFor('VIEWED', true)).toBe('Overdue');
  });

  it('keeps Partially Paid distinct from Unpaid when not overdue', () => {
    expect(bucketFor('PARTIALLY_PAID', false)).toBe('Partially Paid');
    expect(bucketFor('SENT', false)).toBe('Unpaid');
    expect(bucketFor('VIEWED', false)).toBe('Unpaid');
    expect(bucketFor('PENDING_PAYMENT', false)).toBe('Unpaid');
  });

  it('never lets a draft or paid invoice read as overdue even if the flag is set', () => {
    // The overlay only ever applies to a still-payable status in practice
    // (InvoicesService clears `overdue` on settle) — this pins the
    // function's own contract regardless of what upstream guarantees.
    expect(bucketFor('DRAFT', false)).toBe('Draft');
    expect(bucketFor('PAID', false)).toBe('Paid');
  });

  it('excludes cancelled invoices from every bucket', () => {
    expect(bucketFor('CANCELLED', false)).toBeNull();
    expect(bucketFor('CANCELLED', true)).toBeNull();
  });
});

describeWithDb('DashboardService', () => {
  const prisma = new InvoicingPrismaService(env!);
  const queue = createRecordingQueueService();
  // The integrations banner is the platform's (getIntegrationsStatus) and is
  // not exercised here.
  const dashboard = new DashboardService(prisma, queue, {} as ZohoConnectionService, env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.INVOICING_DIRECT_DATABASE_URL ?? env!.INVOICING_DATABASE_URL } },
  });

  let brandId = '';
  let merchantId = '';
  let ownerScope: RequestScope;
  let customerId = '';

  beforeAll(async () => {
    const brand = await owner.brand.findFirst({
      where: { displayName: 'Cobalt Studio Supply' },
      select: { id: true, merchantId: true },
    });
    if (!brand) throw new Error('seed data missing — run pnpm db:seed');
    brandId = brand.id;
    merchantId = brand.merchantId;
    ownerScope = {
      merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };

    const customer = await owner.customer.create({
      data: {
        brandId,
        type: 'BUSINESS',
        displayName: 'Dashboard Test Co',
        companyName: 'Dashboard Test Co',
        email: 'ap@dashboard-test.example',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  function invoiceDefaults() {
    const now = new Date();
    return {
      brandId,
      customerId,
      number: `DASH-${randomUUID().slice(0, 8)}`,
      currency: 'USD',
      invoiceDate: now,
      dueDate: now,
      publicToken: randomUUID().replace(/-/g, ''),
    };
  }

  it("sums this month's invoiced and collected totals, and computes the rate from them", async () => {
    const invoice = await owner.invoice.create({
      data: {
        ...invoiceDefaults(),
        status: 'SENT',
        issuedAt: new Date(),
        totalMinor: 100_000n,
        balanceMinor: 40_000n,
      },
    });
    await owner.payment.create({
      data: {
        invoiceId: invoice.id,
        brandId,
        method: 'ACH',
        amountMinor: 60_000n,
        currency: 'USD',
        status: 'SETTLED',
        settledAt: new Date(),
        gatewayReference: `test-${invoice.id}`,
        idempotencyKey: `test-${invoice.id}`,
      },
    });

    const summary = await dashboard.getSummary(ownerScope, brandId);
    expect(summary.invoicedMinor).toBeGreaterThanOrEqual(100_000);
    expect(summary.collectedMinor).toBeGreaterThanOrEqual(60_000);
    expect(summary.collectionRate).toBeGreaterThan(0);
    expect(summary.collectionRate).toBeLessThanOrEqual(1);
  });

  describe('a chosen period (Last Month, This Quarter, ...)', () => {
    // A month of its own, far from every other test's invoices.
    const january2020 = {
      start: new Date('2020-01-01T00:00:00Z'),
      end: new Date('2020-02-01T00:00:00Z'),
    };
    const february2020 = {
      start: new Date('2020-02-01T00:00:00Z'),
      end: new Date('2020-03-01T00:00:00Z'),
    };
    const dated = (status: 'SENT' | 'DRAFT' | 'CANCELLED' | 'PAID', totalMinor: bigint) =>
      owner.invoice.create({
        data: {
          ...invoiceDefaults(),
          invoiceDate: new Date('2020-01-15T00:00:00Z'),
          dueDate: new Date('2020-02-14T00:00:00Z'),
          status,
          // Imported from Zoho: never issued in this app.
          issuedAt: null,
          totalMinor,
          balanceMinor: status === 'PAID' ? 0n : totalMinor,
        },
      });

    // The test brand outlives a run: start from an empty month, and leave one.
    const clear = () =>
      owner.invoice.deleteMany({
        where: { brandId, invoiceDate: { gte: january2020.start, lt: february2020.end } },
      });

    afterAll(clear);

    beforeAll(async () => {
      await clear();
      await dated('SENT', 70_000n);
      await dated('PAID', 30_000n);
      await dated('DRAFT', 5_000n);
      await dated('CANCELLED', 9_000n);
    });

    it('counts invoices by their invoice date, including ones imported from Zoho', async () => {
      const summary = await dashboard.getSummary(ownerScope, brandId, january2020);
      // SENT + PAID; the draft and the cancelled one are not invoiced.
      expect(summary.invoicedMinor).toBe(100_000);

      const empty = await dashboard.getSummary(ownerScope, brandId, february2020);
      expect(empty.invoicedMinor).toBe(0);
    });

    it('gives the by-brand roll-up the same period', async () => {
      const rollup = await dashboard.getByBrand(ownerScope, january2020);
      expect(rollup.find((r) => r.brandId === brandId)?.invoicedMinor).toBe(100_000);
    });

    it('limits the status breakdown to invoices dated in the period', async () => {
      const breakdown = await dashboard.getStatusBreakdown(ownerScope, brandId, january2020);
      expect(Object.fromEntries(breakdown.map((b) => [b.bucket, b.amountMinor]))).toEqual({
        Paid: 30_000,
        Unpaid: 70_000,
        Draft: 5_000,
      });

      expect(await dashboard.getStatusBreakdown(ownerScope, brandId, february2020)).toEqual([]);
    });
  });

  describe('every widget follows the date filter, in one currency', () => {
    // March 2020: a month of its own, apart from every other test.
    const march2020 = {
      start: new Date('2020-03-01T00:00:00Z'),
      end: new Date('2020-04-01T00:00:00Z'),
    };
    const april2020 = {
      start: new Date('2020-04-01T00:00:00Z'),
      end: new Date('2020-05-01T00:00:00Z'),
    };
    const clear = async () => {
      const invoices = await owner.invoice.findMany({
        where: { brandId, invoiceDate: { gte: march2020.start, lt: april2020.end } },
        select: { id: true },
      });
      await owner.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
      await owner.invoice.deleteMany({ where: { id: { in: invoices.map((i) => i.id) } } });
    };
    const make = (
      day: string,
      data: { status: 'SENT' | 'PAID'; total: bigint; overdue?: boolean; currency?: string },
    ) =>
      owner.invoice.create({
        data: {
          ...invoiceDefaults(),
          currency: data.currency ?? 'USD',
          invoiceDate: new Date(`2020-03-${day}T00:00:00Z`),
          dueDate: new Date(`2020-03-${day}T00:00:00Z`),
          status: data.status,
          overdue: data.overdue ?? false,
          issuedAt: null,
          totalMinor: data.total,
          balanceMinor: data.status === 'PAID' ? 0n : data.total,
        },
      });

    afterAll(clear);

    beforeAll(async () => {
      await clear();
      await make('10', { status: 'SENT', total: 50_000n, overdue: true });
      // A smaller amount in another currency: never added to the USD figures.
      await make('10', { status: 'SENT', total: 9_000n, overdue: true, currency: 'EUR' });
      const paid = await make('20', { status: 'PAID', total: 30_000n });
      await owner.payment.create({
        data: {
          invoiceId: paid.id,
          brandId,
          method: 'ACH',
          amountMinor: 30_000n,
          currency: 'USD',
          status: 'SETTLED',
          settledAt: new Date('2020-03-21T12:00:00Z'),
          gatewayReference: `test-${paid.id}`,
          idempotencyKey: `test-${paid.id}`,
        },
      });
    });

    it('draws both charts over the chosen period, one point per day for a month', async () => {
      const trend = await dashboard.getTrend(ownerScope, brandId, march2020);

      expect(trend).toHaveLength(31);
      expect(trend.every((p) => p.granularity === 'day')).toBe(true);
      const day = (key: string) => trend.find((p) => p.month === key)!;
      expect(day('2020-03-10')).toMatchObject({ invoicedMinor: 50_000, collectedMinor: 0 });
      expect(day('2020-03-20')).toMatchObject({ invoicedMinor: 30_000, collectedMinor: 0 });
      expect(day('2020-03-21')).toMatchObject({ invoicedMinor: 0, collectedMinor: 30_000 });
    });

    it('draws a year month by month', async () => {
      const year = await dashboard.getTrend(ownerScope, brandId, {
        start: new Date('2020-01-01T00:00:00Z'),
        end: new Date('2021-01-01T00:00:00Z'),
      });

      expect(year).toHaveLength(12);
      expect(year.find((p) => p.month === '2020-03')).toMatchObject({
        invoicedMinor: 80_000,
        collectedMinor: 30_000,
        granularity: 'month',
      });
    });

    it('counts overdue among the invoices dated in the period', async () => {
      expect((await dashboard.getSummary(ownerScope, brandId, march2020)).overdueMinor).toBe(
        50_000,
      );
      expect((await dashboard.getSummary(ownerScope, brandId, april2020)).overdueMinor).toBe(0);
    });

    it('lists the top overdue customers for the period', async () => {
      const march = await dashboard.getTopOverdueCustomers(ownerScope, brandId, march2020);
      expect(march.map((c) => [c.customerId, c.balanceMinor])).toEqual([[customerId, 50_000]]);
      expect(await dashboard.getTopOverdueCustomers(ownerScope, brandId, april2020)).toEqual([]);
    });

    it('shows the activity of the period', async () => {
      const march = await dashboard.getRecentActivity(ownerScope, brandId, march2020);
      expect(march.map((a) => a.kind)).toEqual(['PAYMENT_RECEIVED']);
      expect(march[0]!.message).toContain('$300.00');
      expect(await dashboard.getRecentActivity(ownerScope, brandId, april2020)).toEqual([]);
    });

    it('keeps the status breakdown to one currency', async () => {
      const breakdown = await dashboard.getStatusBreakdown(ownerScope, brandId, march2020);
      expect(Object.fromEntries(breakdown.map((b) => [b.bucket, b.amountMinor]))).toEqual({
        Paid: 30_000,
        Overdue: 50_000,
      });
    });
  });

  it('buckets an overdue partially-paid invoice as Overdue, not Partially Paid', async () => {
    await owner.invoice.create({
      data: {
        ...invoiceDefaults(),
        status: 'PARTIALLY_PAID',
        overdue: true,
        totalMinor: 50_000n,
        balanceMinor: 20_000n,
      },
    });

    const breakdown = await dashboard.getStatusBreakdown(ownerScope, brandId);
    const overdue = breakdown.find((b) => b.bucket === 'Overdue');
    expect(overdue).toBeDefined();
    expect(overdue!.amountMinor).toBeGreaterThanOrEqual(50_000);
  });

  it("refuses to retry a sync job for a brand outside the caller's scope", async () => {
    const otherMerchantBrand = await owner.brand.findFirst({
      where: { merchantId: { not: merchantId } },
      select: { id: true },
    });
    if (!otherMerchantBrand) return; // single-merchant dev DB — nothing to assert here

    const job = await owner.syncJob.create({
      data: {
        brandId: otherMerchantBrand.id,
        provider: 'ZOHO_BOOKS',
        direction: 'PUSH',
        objectType: 'INVOICE',
        objectId: randomUUID(),
        status: 'FAILED',
      },
    });

    await expect(dashboard.retrySyncJob(ownerScope, job.id)).rejects.toThrow(NotFoundException);
    await owner.syncJob.delete({ where: { id: job.id } });
  });

  it("re-enqueues a PUSH/INVOICE failure as zoho-push-invoice with the job's own invoiceId", async () => {
    const invoice = await owner.invoice.create({ data: { ...invoiceDefaults(), status: 'SENT' } });
    const job = await owner.syncJob.create({
      data: {
        brandId,
        provider: 'ZOHO_BOOKS',
        direction: 'PUSH',
        objectType: 'INVOICE',
        objectId: invoice.id,
        status: 'FAILED',
      },
    });

    const result = await dashboard.retrySyncJob(ownerScope, job.id);
    expect(result).toEqual({ queued: true });
    expect(queue.enqueued).toContainEqual(
      expect.objectContaining({
        queue: 'sync',
        jobName: 'zoho-push-invoice',
        payload: expect.objectContaining({ brandId, invoiceId: invoice.id }),
      }),
    );

    await owner.syncJob.delete({ where: { id: job.id } });
  });

  it('re-enqueues a PULL failure as a forced zoho-pull-brand, not a per-object push', async () => {
    const job = await owner.syncJob.create({
      data: {
        brandId,
        provider: 'ZOHO_BOOKS',
        direction: 'PULL',
        objectType: 'INVOICE',
        status: 'FAILED',
      },
    });

    await dashboard.retrySyncJob(ownerScope, job.id);
    expect(queue.enqueued).toContainEqual(
      expect.objectContaining({
        queue: 'sync',
        jobName: 'zoho-pull-brand',
        payload: expect.objectContaining({ brandId, force: true }),
      }),
    );

    await owner.syncJob.delete({ where: { id: job.id } });
  });

  it('refuses to retry a job with no recorded objectId — nothing to replay', async () => {
    const job = await owner.syncJob.create({
      data: {
        brandId,
        provider: 'ZOHO_BOOKS',
        direction: 'PUSH',
        objectType: 'CUSTOMER',
        status: 'FAILED',
      },
    });

    await expect(dashboard.retrySyncJob(ownerScope, job.id)).rejects.toThrow(BadRequestException);
    await owner.syncJob.delete({ where: { id: job.id } });
  });

  describe('getNeedsAttention', () => {
    it('lists invoices only — no Zoho sync failures or quiet Zoho connections', async () => {
      // A failed sync job on the shared brand, and a brand connected to Zoho
      // long ago with no sync since: both used to show here.
      const job = await owner.syncJob.create({
        data: {
          brandId,
          provider: 'ZOHO_BOOKS',
          direction: 'PULL',
          objectType: 'INVOICE',
          objectId: randomUUID(),
          status: 'FAILED',
          errorClass: 'TRANSIENT',
          lastError: 'Zoho Books: GET /books/v3/invoices failed with 429',
        },
      });
      const brand = await createInvoicingBrand(owner, {
        displayName: `Quiet Zoho Brand ${randomUUID().slice(0, 8)}`,
      });
      await owner.zohoConnection.create({
        data: {
          brandId: brand.id,
          status: 'CONNECTED',
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      });
      const scope: RequestScope = {
        merchantId: brand.merchantId,
        userId: 'test-harness',
        role: 'MERCHANT_OWNER',
        assignedBrandIds: [],
        sessionId: 'test-session',
        sourceIp: null,
      };

      const shared = await dashboard.getNeedsAttention(ownerScope, brandId);
      const quiet = await dashboard.getNeedsAttention(scope, brand.id);

      for (const item of [...shared.items, ...quiet.items]) {
        expect(['STALE_DRAFT', 'DUE_SOON']).toContain(item.kind);
      }
      expect(quiet.totalCount).toBe(0);

      await owner.syncJob.delete({ where: { id: job.id } });
      await deleteInvoicingBrand(owner, brand.id);
    });
  });

  describe('getRecentActivity', () => {
    it('reports a newly created customer as CUSTOMER_ADDED only, then as CUSTOMER_UPDATED once edited — never both at once', async () => {
      const created = await owner.customer.create({
        data: {
          brandId,
          type: 'BUSINESS',
          displayName: 'Recent Activity Probe',
          email: 'recent-activity-probe@dashboard-test.example',
        },
      });

      const afterCreate = await dashboard.getRecentActivity(ownerScope, brandId);
      const forThisCustomer = (items: typeof afterCreate) =>
        items.filter((i) => i.message.includes('Recent Activity Probe'));

      expect(forThisCustomer(afterCreate)).toEqual([
        expect.objectContaining({ kind: 'CUSTOMER_ADDED' }),
      ]);

      // Prisma's @updatedAt has second-level precision in Postgres timestamps
      // in practice here; without a real gap updatedAt could tie createdAt.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await owner.customer.update({
        where: { id: created.id },
        data: { displayName: 'Recent Activity Probe (edited)' },
      });

      // Customers aren't versioned, so both entries read the row's current
      // (post-edit) displayName — the point under test is that the edit adds
      // its own CUSTOMER_UPDATED entry alongside the original CUSTOMER_ADDED
      // one, rather than replacing it or going unreported.
      const afterEdit = await dashboard.getRecentActivity(ownerScope, brandId);
      const entriesForProbe = afterEdit.filter((i) => i.message.includes('Recent Activity Probe'));
      expect(entriesForProbe.map((i) => i.kind).sort()).toEqual([
        'CUSTOMER_ADDED',
        'CUSTOMER_UPDATED',
      ]);
      expect(entriesForProbe).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'CUSTOMER_UPDATED',
            message: 'Customer Recent Activity Probe (edited) updated',
          }),
        ]),
      );

      await owner.customer.delete({ where: { id: created.id } });
    });
  });
});
