/**
 * PaymentsService against a real database and the real FakeGatewayAdapter —
 * this is the highest-stakes code in the platform (TDD-001 §8.3), so it is
 * exercised end to end rather than mocked. Needs a migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerInput, InvoiceDraftInput, PublicScope, RequestScope } from '@fenwick/shared';
import { createFakeMailPort } from '../adapters/mail/fake-mail.port.js';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { createFakeQueueService } from '../infra/queue/fake-queue.service.js';
import { FakeGatewayAdapter } from '../adapters/gateway/fake-gateway.adapter.js';
import { CustomersService } from '../customers/customers.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PaymentsService } from './payments.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('PaymentsService', () => {
  const prisma = new PrismaService(env!);
  const gateway = new FakeGatewayAdapter();
  const queue = createFakeQueueService();
  const customers = new CustomersService(prisma, queue);
  const invoices = new InvoicesService(prisma, queue, createFakeMailPort(), env!);
  const payments = new PaymentsService(prisma, env!, gateway, queue);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let merchantId = '';
  let brandId = '';
  let customerId = '';
  let ownerScope: RequestScope;

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

    // This suite exercises settlement mechanics via ACH throughout; whether
    // ACH is *offered* at all is a separate concern (FR-PAY-005), covered by
    // its own test below, not something these fixtures should be tripped up
    // by. ACH defaults off for a fresh brand, so it is turned on here.
    await owner.brandSettings.update({ where: { brandId }, data: { achEnabled: true } });

    const customerInput: CustomerInput = {
      type: 'BUSINESS',
      salutation: null,
      firstName: null,
      lastName: null,
      companyName: 'Payments Test Co',
      displayName: 'Payments Test Co',
      email: 'ap@payments-test.example',
      phone: null,
      billingAddress: null,
      shippingAddress: null,
    };
    const customer = await customers.create(ownerScope, brandId, customerInput);
    customerId = customer.id;
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  /** A fresh, issued invoice with a total ending in the given two digits, so
   * FakeGateway's scenario selection is exact rather than incidental. */
  async function issuedInvoice(
    lastTwoDigits: string,
  ): Promise<{ id: string; publicScope: PublicScope }> {
    const draft: InvoiceDraftInput = {
      brandId,
      customerId,
      invoiceDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      currency: 'USD',
      lines: [
        {
          itemName: 'Test line',
          description: null,
          quantity: '1',
          unitPrice: `100.${lastTwoDigits}`,
          taxExempt: true,
        },
      ],
      taxRateBp: 0,
      cardFeeRateBp: 0,
      notes: null,
      internalNotes: null,
    };
    const created = await invoices.create(ownerScope, brandId, draft);
    await invoices.issue(ownerScope, brandId, created.id);
    return {
      id: created.id,
      publicScope: { kind: 'PUBLIC', merchantId, brandId, invoiceId: created.id, sourceIp: null },
    };
  }

  it('settles successfully and clears the balance (amount not ending 11/22/33)', async () => {
    const { id, publicScope } = await issuedInvoice('40');
    const result = await payments.createIntent(publicScope, 'ACH', randomUUID());

    expect(result.gatewayStatus).toBe('SUCCEEDED');
    expect(result.invoiceStatus).toBe('PAID');

    const row = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PAID');
    expect(row.balanceMinor).toBe(0n);
    expect(row.paidAt).not.toBeNull();
  });

  it('declines and reverts the invoice to its pre-attempt status, balance untouched', async () => {
    const { id, publicScope } = await issuedInvoice('11');
    const before = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(before.status).toBe('SENT'); // never viewed in this test — the guard.

    const result = await payments.createIntent(publicScope, 'ACH', randomUUID());

    expect(result.gatewayStatus).toBe('FAILED');
    expect(result.declineReason).toMatch(/insufficient funds/);
    expect(result.invoiceStatus).toBe('SENT');

    const after = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('SENT');
    expect(after.balanceMinor).toBe(before.balanceMinor);
    expect(after.previousStatus).toBeNull(); // cleared once reverted, not left dangling
  });

  it('goes to PENDING_PAYMENT on the pending scenario and stays there until a webhook settles it', async () => {
    const { id, publicScope } = await issuedInvoice('22');
    const result = await payments.createIntent(publicScope, 'ACH', randomUUID());

    expect(result.gatewayStatus).toBe('PROCESSING');
    expect(result.invoiceStatus).toBe('PENDING_PAYMENT');

    const payment = await owner.payment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(payment.status).toBe('PROCESSING');
    expect(payment.gatewayReference).not.toBeNull();

    const { body, headers } = gateway.simulateWebhook(
      payment.gatewayReference!,
      'PAYMENT_SUCCEEDED',
    );
    await payments.handleWebhook(Buffer.from(body), headers);

    const settled = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(settled.status).toBe('PAID');
    expect(settled.balanceMinor).toBe(0n);
  });

  it('is idempotent on (invoice, amount, attemptNonce): a repeated call never charges twice', async () => {
    const { id, publicScope } = await issuedInvoice('50');
    const nonce = randomUUID();

    const first = await payments.createIntent(publicScope, 'ACH', nonce);
    const second = await payments.createIntent(publicScope, 'ACH', nonce);

    expect(first.gatewayStatus).toBe('SUCCEEDED');
    expect(second.gatewayStatus).toBe('SUCCEEDED');

    const count = await owner.payment.count({ where: { invoiceId: id } });
    expect(count).toBe(1);
  });

  // These three all need a genuinely PENDING payment before the webhook
  // fires — anything except a 11/22/33 ending settles synchronously inside
  // createIntent, which would make every assertion below pass for the wrong
  // reason (the transition guard refusing to re-settle a PAID invoice, not
  // the mechanism actually under test). 22 is the only ending that leaves a
  // real PROCESSING payment for a webhook to act on.

  it('rejects a webhook with an invalid signature without changing any state', async () => {
    const { id, publicScope } = await issuedInvoice('22');
    await payments.createIntent(publicScope, 'ACH', randomUUID());
    const payment = await owner.payment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(payment.status).toBe('PROCESSING'); // precondition, not the thing under test

    const body = JSON.stringify({
      id: 'evt_forged',
      type: 'PAYMENT_SUCCEEDED',
      gatewayReference: payment.gatewayReference,
      amountMinor: 10022,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
    });

    await expect(
      payments.handleWebhook(Buffer.from(body), { 'x-fake-signature': 'not-a-real-signature' }),
    ).rejects.toThrow(/invalid webhook signature/);

    const untouched = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(untouched.status).toBe('PENDING_PAYMENT');
  });

  it('discards a replayed webhook rather than settling twice', async () => {
    const { id, publicScope } = await issuedInvoice('22');
    await payments.createIntent(publicScope, 'ACH', randomUUID());
    const payment = await owner.payment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(payment.status).toBe('PROCESSING');

    const { body, headers } = gateway.simulateWebhook(
      payment.gatewayReference!,
      'PAYMENT_SUCCEEDED',
    );
    await payments.handleWebhook(Buffer.from(body), headers);
    await payments.handleWebhook(Buffer.from(body), headers); // identical event, replayed

    const settled = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(settled.status).toBe('PAID');
    const count = await owner.payment.count({ where: { invoiceId: id } });
    expect(count).toBe(1);
  });

  it('never applies a webhook older than the last processed event for that payment', async () => {
    const { id, publicScope } = await issuedInvoice('22');
    const created = await payments.createIntent(publicScope, 'ACH', randomUUID());
    expect(created.gatewayStatus).toBe('PROCESSING'); // precondition
    const payment = await owner.payment.findFirstOrThrow({ where: { invoiceId: id } });
    // createIntent already stamped lastEventAt at intent-creation time; a
    // "stale" event dated before that is what out-of-order actually means.
    const before = payment.lastEventAt!;
    const stalePast = new Date(before.getTime() - 60_000);
    const afterNow = new Date(before.getTime() + 60_000);

    const stale = gateway.simulateWebhook(payment.gatewayReference!, 'PAYMENT_FAILED', {
      occurredAt: stalePast,
    });
    await payments.handleWebhook(Buffer.from(stale.body), stale.headers);

    const afterStale = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(afterStale.status).toBe('PENDING_PAYMENT'); // the stale FAILED did not revert it

    const recent = gateway.simulateWebhook(payment.gatewayReference!, 'PAYMENT_SUCCEEDED', {
      occurredAt: afterNow,
    });
    await payments.handleWebhook(Buffer.from(recent.body), recent.headers);

    const settled = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(settled.status).toBe('PAID'); // the newer event applied normally

    // Replaying the same stale FAILED event after settlement must not revert it either.
    await payments.handleWebhook(Buffer.from(stale.body), stale.headers);
    const finalRow = await owner.invoice.findUniqueOrThrow({ where: { id } });
    expect(finalRow.status).toBe('PAID');
  });

  describe('FR-PAY-005 — payment method enablement', () => {
    it('refuses to create an intent for a method the brand has disabled, with no state change', async () => {
      await owner.brandSettings.update({ where: { brandId }, data: { checkEnabled: false } });
      const { id, publicScope } = await issuedInvoice('60');

      await expect(payments.createIntent(publicScope, 'CHECK', randomUUID())).rejects.toThrow(
        /CHECK is not enabled/,
      );

      const row = await owner.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('SENT'); // untouched — never reached INITIATE_PAYMENT
      expect(await owner.payment.count({ where: { invoiceId: id } })).toBe(0);
    });

    it('allows the same method again once re-enabled', async () => {
      await owner.brandSettings.update({ where: { brandId }, data: { achEnabled: false } });
      const { publicScope } = await issuedInvoice('61');
      await expect(payments.createIntent(publicScope, 'ACH', randomUUID())).rejects.toThrow(
        /ACH is not enabled/,
      );

      await owner.brandSettings.update({ where: { brandId }, data: { achEnabled: true } });
      const { publicScope: publicScope2 } = await issuedInvoice('62');
      const result = await payments.createIntent(publicScope2, 'ACH', randomUUID());
      expect(result.gatewayStatus).toBe('SUCCEEDED');
    });

    it('treats WALLET as enabled if either Apple Pay or Google Pay is on', async () => {
      await owner.brandSettings.update({
        where: { brandId },
        data: { applePayEnabled: false, googlePayEnabled: true },
      });
      const { publicScope } = await issuedInvoice('63');
      const result = await payments.createIntent(publicScope, 'WALLET', randomUUID());
      expect(result.gatewayStatus).toBe('SUCCEEDED');

      await owner.brandSettings.update({
        where: { brandId },
        data: { applePayEnabled: false, googlePayEnabled: false },
      });
      const { publicScope: publicScope2 } = await issuedInvoice('64');
      await expect(payments.createIntent(publicScope2, 'WALLET', randomUUID())).rejects.toThrow(
        /WALLET is not enabled/,
      );
    });
  });
});
