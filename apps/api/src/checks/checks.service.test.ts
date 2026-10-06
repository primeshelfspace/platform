/**
 * ChecksService against a real database (same harness as
 * invoices.service.test.ts). Needs a migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @sugrpay/api test
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvoiceDraftInput, RequestScope } from '@sugrpay/shared';
import { createFakeMailPort } from '../adapters/mail/fake-mail.port.js';
import { LocalDiskAdapter } from '../adapters/storage/local-disk.adapter.js';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { createFakeQueueService } from '../infra/queue/fake-queue.service.js';
import { CustomersService } from '../customers/customers.service.js';
import type { ZohoPullService } from '../integrations/zoho-pull.service.js';
import { InvoicePdfService } from '../public/invoice-pdf.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { ChecksService } from './checks.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('ChecksService', () => {
  const prisma = new PrismaService(env!);
  const queue = createFakeQueueService();
  const customers = new CustomersService(prisma, queue);
  const mail = createFakeMailPort();
  const invoices = new InvoicesService(
    prisma,
    queue,
    mail,
    env!,
    new LocalDiskAdapter(env!),
    new InvoicePdfService(),
    {} as ZohoPullService,
  );
  const checks = new ChecksService(prisma, invoices, new LocalDiskAdapter(env!));
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let merchantId = '';
  let solsticeId = '';
  let ownerScope: RequestScope;
  let customerId = '';

  beforeAll(async () => {
    const solstice = await owner.brand.findFirst({
      where: { displayName: 'Cobalt Studio Supply' },
      select: { id: true, merchantId: true },
    });
    if (!solstice) throw new Error('seed data missing — run pnpm db:seed');
    solsticeId = solstice.id;
    merchantId = solstice.merchantId;
    ownerScope = {
      merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };
    customerId = (
      await customers.create(ownerScope, solsticeId, {
        type: 'BUSINESS',
        salutation: null,
        firstName: null,
        lastName: null,
        companyName: 'Checks Test Co',
        phone: null,
        billingAddress: null,
        shippingAddress: null,
        displayName: 'Checks Test Co',
        email: 'ap@checks-test.example',
      })
    ).id;
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  function draft(overrides: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput {
    return {
      brandId: solsticeId,
      customerId,
      invoiceDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      currency: 'USD',
      lines: [
        {
          itemName: 'Widget',
          description: null,
          quantity: '1',
          unitPrice: '500.00',
          taxExempt: true,
        },
      ],
      taxRateBp: 0,
      cardFeeRateBp: 0,
      notes: null,
      internalNotes: null,
      ...overrides,
    };
  }

  /** total 500.00, no tax/fee — a check submission can then claim the full
   * balance without computing a tax-adjusted total. */
  async function issuedInvoice() {
    const created = await invoices.create(ownerScope, solsticeId, draft());
    await invoices.issue(ownerScope, solsticeId, created.id);
    return created;
  }

  async function submitCheck(
    invoiceId: string,
    overrides: Partial<{ checkNumber: string; amountMinor: bigint }> = {},
  ) {
    return owner.checkSubmission.create({
      data: {
        invoiceId,
        brandId: solsticeId,
        checkNumber: overrides.checkNumber ?? `CHK-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        amountMinor: overrides.amountMinor ?? 50000n,
        frontImageKey: `brands/${solsticeId}/checks/test-front`,
        backImageKey: `brands/${solsticeId}/checks/test-back`,
        customerNote: 'Mailed on the 1st',
      },
    });
  }

  describe('list', () => {
    it('buckets SUBMITTED and UNDER_REVIEW under the PENDING status filter', async () => {
      const invoice = await issuedInvoice();
      const submitted = await submitCheck(invoice.id);
      const underReviewRow = await submitCheck(invoice.id);
      const underReview = await owner.checkSubmission.update({
        where: { id: underReviewRow.id },
        data: { status: 'UNDER_REVIEW' },
      });

      const result = await checks.list(ownerScope, solsticeId, {
        status: 'PENDING',
        page: 1,
        pageSize: 50,
      });
      const ids = result.data.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([submitted.id, underReview.id]));
    });

    it('searches by check number', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id, { checkNumber: 'UNIQUE-4471' });

      const result = await checks.list(ownerScope, solsticeId, {
        search: 'unique-4471',
        page: 1,
        pageSize: 25,
      });
      expect(result.data.map((r) => r.id)).toContain(submission.id);
    });
  });

  describe('approve', () => {
    it('records a SETTLED check payment and closes the submission out', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id, { amountMinor: 50000n });

      await checks.approve(ownerScope, solsticeId, submission.id, { note: 'Looks good' });

      const updatedInvoice = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updatedInvoice.status).toBe('PAID');
      expect(updatedInvoice.balanceMinor).toBe(0n);

      const payment = await owner.payment.findFirst({ where: { invoiceId: invoice.id } });
      expect(payment).toMatchObject({
        method: 'CHECK',
        status: 'SETTLED',
        amountMinor: 50000n,
        reference: submission.checkNumber,
      });

      const reviewed = await owner.checkSubmission.findUniqueOrThrow({ where: { id: submission.id } });
      expect(reviewed.status).toBe('APPROVED');
      expect(reviewed.reviewNote).toBe('Looks good');
      expect(reviewed.reviewedBy).toBe('test-harness');
    });

    it('refuses to approve a submission that was already reviewed', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id);
      await checks.approve(ownerScope, solsticeId, submission.id, {});
      await expect(checks.approve(ownerScope, solsticeId, submission.id, {})).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('requires a reason', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id);
      await expect(checks.reject(ownerScope, solsticeId, submission.id, {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('closes the submission out without creating a payment', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id);

      await checks.reject(ownerScope, solsticeId, submission.id, { note: 'Check bounced' });

      const reviewed = await owner.checkSubmission.findUniqueOrThrow({ where: { id: submission.id } });
      expect(reviewed.status).toBe('REJECTED');
      expect(reviewed.reviewNote).toBe('Check bounced');
      expect(await owner.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });
  });

  describe('getDetail', () => {
    it('signs both check image URLs and throws NotFoundException for a missing id', async () => {
      const invoice = await issuedInvoice();
      const submission = await submitCheck(invoice.id);
      const detail = await checks.getDetail(ownerScope, solsticeId, submission.id);
      expect(new URL(detail.frontImageUrl).searchParams.get('key')).toBe(submission.frontImageKey);
      expect(new URL(detail.backImageUrl).searchParams.get('key')).toBe(submission.backImageKey);

      await expect(
        checks.getDetail(ownerScope, solsticeId, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
