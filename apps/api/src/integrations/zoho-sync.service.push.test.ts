/**
 * ZohoSyncService's push methods against a real database and a real Redis —
 * specifically FR-ZHO-webhook's outbound additions: mandatory-field
 * validation blocking a push and recording zohoUnsyncedReason, and the
 * loop-prevention cache key written before the outbound call. The pre-existing
 * push/backfill behaviour is covered by computeBackfillTargets's own pure
 * tests (zoho-sync.service.test.ts) and is not repeated here.
 *
 * ZohoBooksAdapter is hand-mocked (no network); IntegrationConnectionService
 * is a thin stub returning a fixed connection and enabled sync flags — real
 * OAuth/token-refresh behaviour belongs to integration-connection.service.ts's
 * own tests, not this file.
 *
 * Needs a migrated database and Redis: pnpm setup:local
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingConnection, RequestScope } from '@fenwick/shared';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { createFakeQueueService } from '../infra/queue/fake-queue.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import type { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import type { IntegrationConnectionService } from './integration-connection.service.js';
import type { SystemScopeResolver } from '../tenancy/system-scope.js';
import { ZohoSyncService } from './zoho-sync.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('ZohoSyncService push (FR-ZHO-webhook)', () => {
  const prisma = new PrismaService(env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
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
  } as unknown as IntegrationConnectionService;

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
    const merchant = await owner.merchant.create({
      data: { name: `zoho-sync-push-${randomUUID()}`, contactEmail: 'ops@example.com' },
    });
    merchantId = merchant.id;
    const brand = await owner.brand.create({
      data: { merchantId, legalName: 'Push Test Brand', displayName: 'Push Test Brand' },
    });
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
    await owner.merchant.delete({ where: { id: merchantId } }).catch(() => undefined);
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
        currency: 'PKR',
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
    expect(updated.zohoUnsyncedReason).toMatch(/PKR/);
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
