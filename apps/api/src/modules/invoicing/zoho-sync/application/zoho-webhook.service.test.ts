/**
 * ZohoWebhookService against a real database and a real Redis — the two
 * things worth exercising for real here:
 *
 *  1. Existing-record resolution goes through Customer/Invoice's real
 *     zoho_contact_id/zoho_invoice_id unique lookup, and routing for a
 *     brand-new Zoho-native record goes through the platform's real
 *     IntegrationConnection (provider, organization_id) matching — both are
 *     exactly the kind of "looked right in the mock" bug a fake DB would hide.
 *     Brands and connections are therefore real platform records, created
 *     through the platform harness.
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
import { PrismaClient } from '../../database/client.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestScope } from '@platform/kernel';
import { loadEnv } from '../../../../shared/config/load-env.js';
import { getEnv } from '../../../../shared/config/env.js';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { RedisService } from '../../../../shared/infra/redis/redis.service.js';
import type { ZohoBooksAdapter } from '../../../../shared/adapters/accounting/zoho-books.adapter.js';
import { IntegrationConnectionService } from '../../../platform/public-api.js';
import { createPlatformHarness } from '../../testing/platform-harness.test-support.js';
import type { ZohoPullService } from './zoho-pull.service.js';
import { ZohoWebhookService } from './zoho-webhook.service.js';

loadEnv();
const hasDb = Boolean(process.env['INVOICING_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('ZohoWebhookService', () => {
  const prisma = new InvoicingPrismaService(env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.INVOICING_DIRECT_DATABASE_URL ?? env!.INVOICING_DATABASE_URL } },
  });
  const redis = new RedisService(env!);
  const platform = createPlatformHarness(env!, prisma);
  // The real platform service: routing by organization is what is under test.
  const connections = new IntegrationConnectionService(
    platform.prisma,
    env!,
    {} as ZohoBooksAdapter,
    redis,
  );

  let merchantId = '';
  let brandA = '';
  let brandB = '';
  let scope: RequestScope;
  const cleanupBrandIds: string[] = [];

  async function makeBrand(): Promise<string> {
    const brand = await platform.createBrand(merchantId, `Test Brand ${randomUUID()}`);
    cleanupBrandIds.push(brand.id);
    return brand.id;
  }

  async function connectZoho(brandId: string, organizationId: string): Promise<void> {
    await platform.owner.integrationConnection.create({
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
    merchantId = await platform.createMerchant(`Zoho webhook test ${randomUUID()}`);
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
    // Pending assignments carry the merchant id but no foreign key to it (the
    // merchant lives in the platform database), so they are cleared here.
    await owner.pendingBrandAssignment.deleteMany({ where: { merchantId } });
    // Platform side cascades brands and connections; invoicing side cascades
    // every customer and invoice under the brand copies.
    await platform.deleteMerchant(merchantId, cleanupBrandIds);
  });

  afterAll(async () => {
    await Promise.all([
      prisma.$disconnect(),
      owner.$disconnect(),
      redis.onModuleDestroy(),
      platform.close(),
    ]);
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
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

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

  it('passes a second contact update within 30s through, leaving redelivery to the pull version check', async () => {
    const contactId = `contact-${randomUUID()}`;
    await owner.customer.create({
      data: { brandId: brandA, displayName: 'Acme Co', zohoContactId: contactId },
    });
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

    // A 30s guard here used to drop a genuine second edit made in Zoho; a true
    // redelivery is a no-op in pullOneCustomer's last_modified_time check.
    await service.handleContactEvent('status_updated', 'org-x', contactId);
    const second = await service.handleContactEvent('status_updated', 'org-x', contactId);

    expect(second.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledTimes(2);
  });

  // --- New records created natively in Zoho -----------------------------------

  it('auto-routes a brand-new Zoho contact when its organization maps to exactly one brand', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

    const result = await service.handleContactEvent('created', organizationId, contactId);

    expect(result.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandA, contactId);
  });

  it('drops a duplicate delivery of the same new-record event before it reaches pullOneCustomerNow twice', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

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
    const service = new ZohoWebhookService(prisma, redis, pull, connections);
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
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

    const result = await service.handleContactEvent(
      'created',
      `org-unknown-${randomUUID()}`,
      `contact-${randomUUID()}`,
    );

    expect(result.status).toBe(404);
    expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();
  });

  it('imports an edit to a never-seen record when its organization maps to exactly one brand', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const contactId = `contact-${randomUUID()}`; // never seen locally
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

    const result = await service.handleContactEvent('status_updated', organizationId, contactId);

    expect(result.status).toBe(200);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandA, contactId);
    expect(await service.listPendingAssignments(scope)).toHaveLength(0);
  });

  it('updates every brand holding a copy of the record when two brands share an organization', async () => {
    const contactId = `contact-${randomUUID()}`;
    await owner.customer.create({
      data: { brandId: brandA, displayName: 'Shared Co', zohoContactId: contactId },
    });
    await owner.customer.create({
      data: { brandId: brandB, displayName: 'Shared Co', zohoContactId: contactId },
    });
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);

    await service.handleContactEvent('unspecified', 'org-x', contactId);

    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandA, contactId);
    expect(pull.pullOneCustomerNow).toHaveBeenCalledWith(brandB, contactId);
  });

  it('records the last delivery per organization, including a pull that failed', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    const pull = {
      pullOneCustomerNow: vi.fn().mockResolvedValue(true),
      pullOneInvoiceNow: vi.fn().mockRejectedValue(new Error('invoice not found in Zoho')),
    } as unknown as ZohoPullService;
    const service = new ZohoWebhookService(prisma, redis, pull, connections);
    const invoiceId = `invoice-${randomUUID()}`;

    const result = await service.handleInvoiceEvent('created', organizationId, invoiceId);

    // Answered 200 — the scheduled pull is the safety net, a 5xx would only
    // make Zoho redeliver into the same failure.
    expect(result.status).toBe(200);
    expect(await service.lastDelivery(organizationId)).toMatchObject({
      objectType: 'INVOICE',
      remoteId: invoiceId,
      outcome: 'failed — invoice not found in Zoho',
    });
  });

  // --- Assignment --------------------------------------------------------------

  it('assigns a pending multi-brand record to one of the brands actually connected to that organization', async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    await connectZoho(brandB, organizationId);
    const contactId = `contact-${randomUUID()}`;
    const pull = fakePull();
    const service = new ZohoWebhookService(prisma, redis, pull, connections);
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
    const service = new ZohoWebhookService(prisma, redis, pull, connections);
    await service.handleContactEvent('created', organizationId, `contact-${randomUUID()}`);
    const [pending] = await service.listPendingAssignments(scope);

    await expect(service.assignPendingRecord(scope, pending!.id, outsiderBrand)).rejects.toThrow();
    expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();
  });

  it("refuses to assign a pending record to another company's brand on the same organization", async () => {
    const organizationId = `org-${randomUUID()}`;
    await connectZoho(brandA, organizationId);
    await connectZoho(brandB, organizationId);
    // A second company that has connected the very same Zoho organization.
    const otherMerchant = await platform.createMerchant(`Other company ${randomUUID()}`);
    const otherBrand = (await platform.createBrand(otherMerchant, `Other ${randomUUID()}`)).id;
    try {
      await connectZoho(otherBrand, organizationId);
      const pull = fakePull();
      const service = new ZohoWebhookService(prisma, redis, pull, connections);
      await service.handleContactEvent('created', organizationId, `contact-${randomUUID()}`);
      const [pending] = await service.listPendingAssignments(scope);

      await expect(service.assignPendingRecord(scope, pending!.id, otherBrand)).rejects.toThrow();
      expect(pull.pullOneCustomerNow).not.toHaveBeenCalled();
    } finally {
      await owner.pendingBrandAssignment.deleteMany({ where: { merchantId: otherMerchant } });
      await platform.deleteMerchant(otherMerchant, [otherBrand]);
    }
  });
});
