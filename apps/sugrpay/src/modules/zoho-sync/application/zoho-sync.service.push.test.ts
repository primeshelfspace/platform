/**
 * ZohoSyncService's push methods against a real database and a real Redis —
 * specifically FR-ZHO-webhook's outbound additions: mandatory-field
 * validation blocking a push and recording zohoUnsyncedReason, and the
 * loop-prevention cache key written before the outbound call. The pre-existing
 * push/backfill behaviour is covered by computeBackfillTargets's own pure
 * tests (zoho-sync.service.test.ts) and is not repeated here.
 *
 * ZohoBooksAdapter is hand-mocked (no network); ZohoConnectionService
 * is a thin stub returning a fixed connection and enabled sync flags — real
 * OAuth/token-refresh behaviour belongs to integration-connection.service.ts's
 * own tests, not this file.
 *
 * Needs a migrated database and Redis: pnpm setup:local
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../database/client.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingConnection, RequestScope } from '@platform/kernel';
import { loadEnv } from '@platform/server';
import { getEnv } from '@platform/server';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { createFakeQueueService } from '../../../infra/queue/fake-queue.service.js';
import { RedisService } from '@platform/server';
import type { ZohoBooksAdapter } from '../../../adapters/accounting/zoho-books.adapter.js';
import { type ZohoConnectionService } from './zoho-connection.service.js';
import { type SystemScopeResolver } from '../../platform-access/index.js';
import {
  createInvoicingBrand,
  deleteInvoicingBrand,
} from '../../testing/brand-fixture.test-support.js';
import { ZohoSyncService } from './zoho-sync.service.js';

loadEnv();
const hasDb = Boolean(process.env['INVOICING_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('ZohoSyncService push (FR-ZHO-webhook)', () => {
  const prisma = new InvoicingPrismaService(env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.INVOICING_DIRECT_DATABASE_URL ?? env!.INVOICING_DATABASE_URL } },
  });
  const redis = new RedisService(env!);

  let merchantId = '';
  let brandId = '';
  let scope: RequestScope;
  let connection: AccountingConnection;

  const connections = {
    buildAccountingConnection: vi.fn(async () => connection),
    getSyncFlags: vi
      .fn()
      .mockResolvedValue({ customerSyncEnabled: true, invoiceSyncEnabled: true }),
  } as unknown as ZohoConnectionService;

  const systemScope = {
    forBrand: vi.fn(async (id: string) => ({ ...scope, merchantId })),
  } as unknown as SystemScopeResolver;

  function service(zoho: Partial<ZohoBooksAdapter>) {
    return new ZohoSyncService(
      prisma,
      zoho as ZohoBooksAdapter,
      connections,
      systemScope,
      createFakeQueueService(),
      redis,
    );
  }

  beforeEach(async () => {
    // The platform is mocked above, so a brand on invoicing's side is all
    // this needs; the merchant id is just a tenant id here.
    const brand = await createInvoicingBrand(owner, {
      displayName: `Push Test Brand ${randomUUID().slice(0, 8)}`,
    });
    merchantId = brand.merchantId;
    brandId = brand.id;
    connection = {
      brandId,
      organisationId: 'org-1',
      accessToken: 'token',
      refreshToken: null,
      expiresAt: null,
    };
    scope = {
      merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };
  });

  afterEach(async () => {
    await deleteInvoicingBrand(owner, brandId);
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect(), redis.onModuleDestroy()]);
  });

  it('blocks a customer push with no display name, records the reason, and never calls Zoho', async () => {
    const customer = await owner.customer.create({
      data: { brandId, displayName: '   ' }, // whitespace-only: blank once trimmed
    });
    const upsertCustomer = vi.fn();
    const sync = service({ upsertCustomer });

    await expect(sync.pushCustomer(brandId, customer.id)).rejects.toThrow();

    expect(upsertCustomer).not.toHaveBeenCalled();
    const updated = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(updated.zohoUnsyncedReason).toMatch(/display name/);

    const job = await owner.syncJob.findFirstOrThrow({ where: { objectId: customer.id } });
    expect(job.status).toBe('FAILED');
    expect(job.errorClass).toBe('VALIDATION');
  });

  it('blocks an invoice push denominated in an unsupported currency', async () => {
    const customer = await owner.customer.create({
      data: { brandId, displayName: 'Acme Co', zohoContactId: 'contact-1' },
    });
    const invoice = await owner.invoice.create({
      data: {
        brandId,
        customerId: customer.id,
        number: 'INV-0001',
        invoiceDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-31'),
        currency: 'JPY',
        publicToken: randomUUID(),
        lineItems: {
          create: [
            {
              position: 1,
              itemName: 'Widget',
              quantity: 10000,
              unitPriceMinor: 1000n,
              lineTotalMinor: 1000n,
            },
          ],
        },
      },
    });
    const pushInvoice = vi.fn();
    const sync = service({ pushInvoice });

    await expect(sync.pushInvoice(brandId, invoice.id)).rejects.toThrow();

    expect(pushInvoice).not.toHaveBeenCalled();
    const updated = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.zohoUnsyncedReason).toMatch(/JPY/);
  });

  it('writes the loop-prevention cache key before calling Zoho, and clears a prior unsynced reason on success', async () => {
    const customer = await owner.customer.create({
      data: {
        brandId,
        displayName: 'Acme Co',
        zohoUnsyncedReason: 'stale reason from a previous failed attempt',
      },
    });
    const upsertCustomer = vi.fn().mockImplementation(async () => {
      // At the moment Zoho is "called", the guard must already be live —
      // this is the ordering FR-ZHO-webhook's loop prevention depends on.
      expect(await redis.hasSyncAction(brandId, customer.id, 'customer')).toBe(true);
      return { remoteId: 'contact-99', updatedAt: new Date('2026-08-20T10:00:00Z') };
    });
    const sync = service({ upsertCustomer });

    await sync.pushCustomer(brandId, customer.id);

    expect(upsertCustomer).toHaveBeenCalledTimes(1);
    const updated = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(updated.zohoContactId).toBe('contact-99');
    expect(updated.zohoUnsyncedReason).toBeNull();
  });

  it('maps a cancelled invoice to VOID status for the adapter, carrying its existing remoteId', async () => {
    // InvoicesService.cancel only enqueues this push for an invoice already
    // synced to Zoho (zohoInvoiceId set) — this is that path, one layer in:
    // does ZohoSyncService actually tell the adapter to void, not create/update.
    const customer = await owner.customer.create({
      data: { brandId, displayName: 'Acme Co', zohoContactId: 'contact-1' },
    });
    const invoice = await owner.invoice.create({
      data: {
        brandId,
        customerId: customer.id,
        number: 'INV-0003',
        status: 'CANCELLED',
        invoiceDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-31'),
        currency: 'USD',
        zohoInvoiceId: 'remote-invoice-void-1',
        totalMinor: 10000n,
        balanceMinor: 10000n,
        publicToken: randomUUID(),
        lineItems: {
          create: [
            {
              position: 0,
              itemName: 'Widget',
              quantity: 10000,
              unitPriceMinor: 10000n,
              lineTotalMinor: 10000n,
            },
          ],
        },
      },
    });
    const pushInvoice = vi
      .fn()
      .mockResolvedValue({ remoteId: 'remote-invoice-void-1', updatedAt: new Date() });
    const sync = service({ pushInvoice });

    await sync.pushInvoice(brandId, invoice.id);

    expect(pushInvoice).toHaveBeenCalledTimes(1);
    const dto = pushInvoice.mock.calls[0]![1];
    expect(dto.status).toBe('VOID');
    expect(dto.remoteId).toBe('remote-invoice-void-1');
  });

  it('serializes two concurrent first-pushes of the same never-synced invoice into one create', async () => {
    // Reproduces the race enqueueBackfill's own comment used to document as
    // accepted: two jobs (e.g. two payments settling close together) both
    // trying to first-push the same still-unsynced invoice. Without the
    // first-push lock, both would see zohoInvoiceId === null and both call
    // the adapter's create path, producing a duplicate invoice in Zoho.
    const customer = await owner.customer.create({
      data: { brandId, displayName: 'Acme Co', zohoContactId: 'contact-1' },
    });
    const invoice = await owner.invoice.create({
      data: {
        brandId,
        customerId: customer.id,
        number: 'INV-RACE-0001',
        invoiceDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-31'),
        currency: 'USD',
        publicToken: randomUUID(),
        lineItems: {
          create: [
            {
              position: 0,
              itemName: 'Widget',
              quantity: 1,
              unitPriceMinor: 1000n,
              lineTotalMinor: 1000n,
            },
          ],
        },
      },
    });

    const pushInvoice = vi.fn().mockImplementation(async (_connection: unknown, dto: { remoteId: string | null }) => {
      if (dto.remoteId === null) {
        // Only the create call gets an artificial delay — this is the exact
        // window the race exploits: both concurrent callers read
        // zohoInvoiceId === null before either one's create call returns.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { remoteId: 'remote-invoice-race-1', updatedAt: new Date('2026-08-20T10:00:00Z') };
      }
      return { remoteId: dto.remoteId, updatedAt: new Date('2026-08-20T10:00:05Z') };
    });
    const sync = service({ pushInvoice });

    await Promise.all([
      sync.pushInvoice(brandId, invoice.id),
      sync.pushInvoice(brandId, invoice.id),
    ]);

    const createCalls = pushInvoice.mock.calls.filter(([, dto]) => dto.remoteId === null);
    expect(createCalls).toHaveLength(1);

    const updated = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.zohoInvoiceId).toBe('remote-invoice-race-1');
  });

  it('drops a payment with a non-positive amount before ever reaching Zoho', async () => {
    const customer = await owner.customer.create({
      data: { brandId, displayName: 'Acme Co', zohoContactId: 'contact-1' },
    });
    const invoice = await owner.invoice.create({
      data: {
        brandId,
        customerId: customer.id,
        number: 'INV-0002',
        invoiceDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-31'),
        zohoInvoiceId: 'remote-invoice-1',
        publicToken: randomUUID(),
      },
    });
    const payment = await owner.payment.create({
      data: {
        brandId,
        invoiceId: invoice.id,
        method: 'MANUAL',
        amountMinor: 0n,
        idempotencyKey: randomUUID(),
      },
    });
    const pushPayment = vi.fn();
    const sync = service({ pushPayment });

    await expect(sync.pushPayment(brandId, payment.id)).rejects.toThrow();

    expect(pushPayment).not.toHaveBeenCalled();
    const updated = await owner.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.zohoUnsyncedReason).toMatch(/greater than zero/);
  });
});
