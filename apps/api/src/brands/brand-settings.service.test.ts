/**
 * BrandSettingsService against a real database (TDD-001 §12.1).
 *
 * The point of these tests is the *write*: a Branding save spans two tables
 * (Brand.themeColor and the brand_settings row) and must land as one
 * transaction, leaving no column it was not asked to touch. That is not
 * something a mocked Prisma can demonstrate — RLS, the transaction boundary
 * and the append-only audit row are all database behaviour. Needs a
 * migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestScope } from '@fenwick/shared';
import { createFakeMailPort } from '../adapters/mail/fake-mail.port.js';
import { LocalDiskAdapter } from '../adapters/storage/local-disk.adapter.js';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { BrandSettingsService } from './brand-settings.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('BrandSettingsService', () => {
  const prisma = new PrismaService(env!);
  const settings = new BrandSettingsService(
    prisma,
    createFakeMailPort(),
    env!,
    new LocalDiskAdapter(env!),
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let brandId = '';
  let scope: RequestScope;

  // A brand of its own rather than a seeded one: every test here mutates
  // branding columns, and a shared fixture would make the assertions depend
  // on execution order.
  beforeAll(async () => {
    const seed = await owner.brand.findFirst({ select: { merchantId: true } });
    if (!seed) throw new Error('seed data missing — run pnpm db:seed');

    const brand = await owner.brand.create({
      data: {
        merchantId: seed.merchantId,
        legalName: 'Branding Fixture Ltd.',
        displayName: `Branding Fixture ${randomUUID().slice(0, 8)}`,
        themeColor: '#2D6A6A',
        settings: { create: { invoicePrefix: 'BFX' } },
      },
    });
    brandId = brand.id;
    scope = {
      merchantId: seed.merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: '203.0.113.7',
    };
  });

  afterAll(async () => {
    if (brandId) await owner.brand.delete({ where: { id: brandId } });
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  // Each test starts from the same known branding state, so one test's
  // writes cannot be mistaken for another's.
  beforeEach(async () => {
    await owner.brand.update({ where: { id: brandId }, data: { themeColor: '#2D6A6A' } });
    await owner.brandSettings.update({
      where: { brandId },
      data: {
        accentColor: '#CC0066',
        paymentPageLayout: 'BANNER',
        emailReceiptLayout: 'CLASSIC',
        emailReceiptSubject: 'Seed subject',
        emailReceiptBody: 'Seed body.',
        invoicePdfLayout: 'CLASSIC',
      },
    });
    await owner.auditLog.deleteMany({ where: { brandId } });
  });

  const pdfInput = {
    themeColor: '#2D6A6A',
    accentColor: '#CC0066',
    invoicePdfLayout: 'MODERN' as const,
    showCompanyAddress: true,
    showPaymentTerms: true,
    showTaxBreakdown: true,
    showNotes: true,
    companyName: null,
    companyAddress: null,
    paymentTerms: 'NET_30' as const,
    notes: 'Thanks.',
  };

  it('keeps a brand colour and the section it was saved from in one transaction', async () => {
    await settings.updateEmailReceiptSettings(scope, brandId, {
      themeColor: '#123456',
      accentColor: '#CC0066',
      emailReceiptLayout: 'HERO',
      emailReceiptSubject: 'Invoice from {{brand_name}}',
      emailReceiptBody: 'Hello {{customer_name}}.',
    });

    const [brand, row] = await Promise.all([
      owner.brand.findUniqueOrThrow({ where: { id: brandId } }),
      owner.brandSettings.findUniqueOrThrow({ where: { brandId } }),
    ]);
    expect(brand.themeColor).toBe('#123456');
    expect(row.emailReceiptLayout).toBe('HERO');
    expect(row.emailReceiptSubject).toBe('Invoice from {{brand_name}}');
  });

  // The regression this suite exists for: the Invoice PDF editor has no
  // accent-colour control, and an earlier version of the save action
  // defaulted the missing field to #171717 and wrote it — so saving the PDF
  // tab silently repainted a brand's accent colour.
  it('leaves the accent colour alone when a section that does not edit it saves', async () => {
    await settings.updateInvoicePdfSettings(scope, brandId, pdfInput);

    const row = await owner.brandSettings.findUniqueOrThrow({ where: { brandId } });
    expect(row.accentColor).toBe('#CC0066');
    expect(row.invoicePdfLayout).toBe('MODERN');
  });

  it('does not touch the brand row when only the section changed', async () => {
    const before = await owner.brand.findUniqueOrThrow({ where: { id: brandId } });
    await settings.updateInvoicePdfSettings(scope, brandId, pdfInput);

    const after = await owner.brand.findUniqueOrThrow({ where: { id: brandId } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('records what changed, without copying long free text into the audit row', async () => {
    await settings.updateEmailReceiptSettings(scope, brandId, {
      themeColor: '#2D6A6A',
      accentColor: '#CC0066',
      emailReceiptLayout: 'MINIMAL',
      emailReceiptSubject: 'A new subject',
      emailReceiptBody: 'x'.repeat(1200),
    });

    const entry = await owner.auditLog.findFirstOrThrow({ where: { brandId } });
    expect(entry.action).toBe('BRAND_EMAIL_RECEIPT_UPDATED');
    expect(entry.objectType).toBe('BRAND_SETTINGS');
    expect(entry.actorId).toBe('test-harness');
    expect(entry.sourceIp).toBe('203.0.113.7');

    const changes = (entry.metadata as { changes: Record<string, unknown> }).changes;
    expect(changes['emailReceiptLayout']).toEqual({ from: 'CLASSIC', to: 'MINIMAL' });
    // Short values are recorded verbatim; only the oversized side is elided,
    // so the entry still says what the body was replaced from.
    expect(changes['emailReceiptBody']).toEqual({ from: 'Seed body.', to: '<changed>' });
    // themeColor was submitted unchanged, so it is not a change.
    expect(changes['themeColor']).toBeUndefined();
  });

  it('writes nothing when the save is rejected', async () => {
    await expect(
      settings.updatePaymentMethods(scope, brandId, {
        cardEnabled: false,
        applePayEnabled: false,
        googlePayEnabled: false,
        achEnabled: false,
        checkEnabled: false,
      }),
    ).rejects.toThrow(/at least one payment method/);

    const row = await owner.brandSettings.findUniqueOrThrow({ where: { brandId } });
    expect(row.cardEnabled).toBe(true);
    const entries = await owner.auditLog.count({ where: { brandId } });
    expect(entries).toBe(0);
  });

  it('refuses a brand belonging to another merchant', async () => {
    const foreign = await owner.brand.findFirst({
      where: { merchantId: { not: scope.merchantId } },
      select: { id: true },
    });
    if (!foreign) throw new Error('seed data missing a second merchant');

    await expect(settings.getEmailReceiptSettings(scope, foreign.id)).rejects.toThrow(/not found/);
  });
});
