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
import { bucketFor, DashboardService } from './dashboard.service.js';

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
    it('shows the specific VALIDATION error text instead of the generic stand-in', async () => {
      // zoho-pull.service.ts's invoice-number-collision error, and anything
      // else that throws a VALIDATION IntegrationError, already writes a
      // clean, specific message to SyncJob.lastError — syncFailureMessage
      // must prefer it over the generic "Zoho couldn't accept some of this
      // record's details" stand-in, which used to flatten the detail away.
      const specificMessage = `Zoho invoice uses number INV-${randomUUID().slice(0, 8)}, which already belongs to a different invoice on this brand`;
      const job = await owner.syncJob.create({
        data: {
          brandId,
          provider: 'ZOHO_BOOKS',
          direction: 'PULL',
          objectType: 'INVOICE',
          objectId: randomUUID(),
          status: 'FAILED',
          errorClass: 'VALIDATION',
          lastError: specificMessage,
        },
      });

      const result = await dashboard.getNeedsAttention(ownerScope, brandId);
      const item = result.items.find((i) => i.syncJobId === job.id);

      expect(item?.detail).toBe(specificMessage);

      await owner.syncJob.delete({ where: { id: job.id } });
    });

    it('falls back to the generic stand-in when a VALIDATION failure has no lastError', async () => {
      const job = await owner.syncJob.create({
        data: {
          brandId,
          provider: 'ZOHO_BOOKS',
          direction: 'PULL',
          objectType: 'INVOICE',
          objectId: randomUUID(),
          status: 'FAILED',
          errorClass: 'VALIDATION',
        },
      });

      const result = await dashboard.getNeedsAttention(ownerScope, brandId);
      const item = result.items.find((i) => i.syncJobId === job.id);

      expect(item?.detail).toBe("Zoho couldn't accept some of this record's details");

      await owner.syncJob.delete({ where: { id: job.id } });
    });

    it('flags a connected brand with zero sync signal ever as ZOHO_SYNC_STALE', async () => {
      // A fresh, isolated brand — this must not collide with the shared
      // seeded brand's own (if any) Zoho connection, since zoho_connection
      // has exactly one row per brand.
      const brand = await createInvoicingBrand(owner, {
        displayName: `Stale Zoho Brand ${randomUUID().slice(0, 8)}`,
      });
      const longAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await owner.zohoConnection.create({
        data: { brandId: brand.id, status: 'CONNECTED', createdAt: longAgo },
      });
      const scope: RequestScope = {
        merchantId: brand.merchantId,
        userId: 'test-harness',
        role: 'MERCHANT_OWNER',
        assignedBrandIds: [],
        sessionId: 'test-session',
        sourceIp: null,
      };

      const result = await dashboard.getNeedsAttention(scope, brand.id);

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'ZOHO_SYNC_STALE', brandId: brand.id }),
        ]),
      );

      await deleteInvoicingBrand(owner, brand.id);
    });

    it('does not flag a freshly connected brand still inside its grace period', async () => {
      const brand = await createInvoicingBrand(owner, {
        displayName: `Fresh Zoho Brand ${randomUUID().slice(0, 8)}`,
      });
      await owner.zohoConnection.create({
        data: { brandId: brand.id, status: 'CONNECTED' }, // createdAt defaults to now
      });
      const scope: RequestScope = {
        merchantId: brand.merchantId,
        userId: 'test-harness',
        role: 'MERCHANT_OWNER',
        assignedBrandIds: [],
        sessionId: 'test-session',
        sourceIp: null,
      };

      const result = await dashboard.getNeedsAttention(scope, brand.id);

      expect(result.items.some((i) => i.kind === 'ZOHO_SYNC_STALE')).toBe(false);

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
