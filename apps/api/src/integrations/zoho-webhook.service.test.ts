/**
 * ZohoWebhookService against a real database and a real Redis — the two
 * things worth exercising for real here:
 *
 *  1. Existing-record resolution goes through Customer/Invoice's real
 *     zoho_contact_id/zoho_invoice_id unique lookup, and routing for a
 *     brand-new Zoho-native record goes through IntegrationConnection's real
 *     (provider, organization_id) matching — both are exactly the kind of
 *     "looked right in the mock" bug a fake DB would hide.
 *  2. Duplicate-webhook dropping is a real Redis TTL key, not a mocked
 *     return value — RedisService is the actual thing ZohoSyncService's
 *     outbound pushes write to.
 *
 * ZohoPullService is hand-mocked: what it does with a resolved (brandId,
 * remoteId) pair is its own, already-tested concern (zoho-pull.service.test.ts)
 * — this file only checks that ZohoWebhookService resolves the *right*
 * (brandId, remoteId) pair, or correctly declines to guess one.
 *
 * Needs a migrated database and Redis: pnpm setup:local
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestScope } from '@fenwick/shared';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import type { ZohoPullService } from './zoho-pull.service.js';
import { ZohoWebhookService } from './zoho-webhook.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('ZohoWebhookService', () => {
  const prisma = new PrismaService(env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });
  const redis = new RedisService(env!);

  let merchantId = '';
  let brandA = '';
  let brandB = '';
  let scope: RequestScope;
  const cleanupBrandIds: string[] = [];

  async function makeBrand(): Promise<string> {
    const brand = await owner.brand.create({
      data: {
        merchantId,
        legalName: `Test Brand ${randomUUID()}`,
        displayName: `Test Brand ${randomUUID()}`,
      },
    });
    cleanupBrandIds.push(brand.id);
    return brand.id;
  }

  async function connectZoho(brandId: string, organizationId: string): Promise<void> {
    await owner.integrationConnection.create({
      data: {
        brandId,
        provider: 'ZOHO_BOOKS',
        status: 'CONNECTED',
        encryptedCredentials: 'unused-in-this-test',
        config: { organizationId, organizationName: 'Test Org' },
      },
    });
  }

  beforeEach(async () => {
    const merchant = await owner.merchant.create({
      data: { name: `Zoho webhook test ${randomUUID()}`, contactEmail: 'ops@example.com' },
    });
    merchantId = merchant.id;
    cleanupBrandIds.length = 0;
    brandA = await makeBrand();
    brandB = await makeBrand();
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
    // Cascades to every brand, customer, invoice, integration connection and
    // pending assignment created under it.
    await owner.merchant.delete({ where: { id: merchantId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect(), redis.onModuleDestroy()]);
  });

  function fakePull(): ZohoPullService {
    return {
      pullOneCustomerNow: vi.fn().mockResolvedValue(true),
      pullOneInvoiceNow: vi.fn().mockResolvedValue(true),
    } as unknown as ZohoPullService;
  }

  // --- Existing-record resolution ---------------------------------------------

  it('resolves an existing customer by its stored zoho_contact_id, never by organization_id', async () => {
    const contactId = `contact-${randomUUID()}`;
    await owner.customer.create({
      data: { brandId: brandA, displayName: 'Acme Co', zohoContactId: contactId },
    });
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    // A deliberately wrong/unrelated organization_id — must not matter at all
    // for a record this platform has already tagged with a brand.
    const result = await service.handleContactEvent(
      'status_updated',
      'org-that-does-not-own-it',
      contactId,
    );

    expect(result.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandA, contactId);
  });

  it('drops a duplicate webhook delivery within the dedup window instead of pulling again', async () => {
    const contactId = `contact-${randomUUID()}`;
    await owner.customer.create({
      data: { brandId: brandA, displayName: 'Acme Co', zohoContactId: contactId },
    });
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    await service.handleContactEvent('status_updated', 'org-x', contactId);
    const second = await service.handleContactEvent('status_updated', 'org-x', contactId);

    expect(second.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledTimes(1);
  });

  // --- New records created natively in Zoho -----------------------------------

  it('auto-routes a brand-new Zoho contact when its organization maps to exactly one brand', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    const result = await service.handleContactEvent('created', organizationId, contactId);

    expect(result.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandA, contactId);
  });

  it('drops a duplicate delivery of the same new-record event before it reaches pullOneCustomerNow twice', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    await service.handleContactEvent('created', organizationId, contactId);
    const second = await service.handleContactEvent('created', organizationId, contactId);

    expect(second.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledTimes(1);
  });

  it('queues a Pending Brand Assignment, never guessing, when the organization maps to more than one brand', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    await connectZoho(brandB, organizationId);
    const invoiceId = `invoice-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);
    const rawPayload = { invoice: { invoice_id: invoiceId, invoice_number: 'INV-9' } };

    const result = await service.handleInvoiceEvent(
      'created',
      organizationId,
      invoiceId,
      rawPayload,
    );

    expect(result.status).toBe(200);
    expect(pull.pullOneInvoiceNow).not.toHaveBeenCalled();

    const pending = await service.listPendingAssignments(scope);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      organizationId,
      objectType: 'INVOICE',
      remoteId: invoiceId,
      reason: 'NEW_RECORD_MULTI_BRAND',
      status: 'PENDING',
      payload: rawPayload,
    });
  });

  it('returns 404 and creates nothing when the organization is not connected to any brand', async () => {
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    const result = await service.handleContactEvent(
      'created',
      `org-unknown-${randomUUID()}`,
      `contact-${randomUUID()}`,
    );

    expect(result.status).toBe(404);
    expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();
  });

  it('logs an orphaned update for manual review instead of guessing a brand, even when the organization is known', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`; // never seen locally
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);

    const result = await service.handleContactEvent('status_updated', organizationId, contactId);

    expect(result.status).toBe(200);
    expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();

    const pending = await service.listPendingAssignments(scope);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ reason: 'ORPHANED_UPDATE', status: 'PENDING' });
  });

  // --- Assignment --------------------------------------------------------------

  it('assigns a pending multi-brand record to one of the brands actually connected to that organization', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    await connectZoho(brandB, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);
    await service.handleContactEvent('created', organizationId, contactId);
    const [pending] = await service.listPendingAssignments(scope);

    await service.assignPendingRecord(scope, pending!.id, brandB);

    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandB, contactId);
    const remaining = await service.listPendingAssignments(scope);
    expect(remaining).toHaveLength(0);
  });

  it('refuses to assign a pending record to a brand not connected to that organization (tenant isolation)', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    await connectZoho(brandB, organizationId);
    const outsiderBrand = await makeBrand(); // same merchant, but never connected to this org
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull);
    await service.handleContactEvent('created', organizationId, `contact-${randomUUID()}`);
    const [pending] = await service.listPendingAssignments(scope);

    await expect(service.assignPendingRecord(scope, pending!.id, outsiderBrand)).rejects.toThrow();
    expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();
  });
});
