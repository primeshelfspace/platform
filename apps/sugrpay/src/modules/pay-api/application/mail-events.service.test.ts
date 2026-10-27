/**
 * MailEventsService against a real database, the way payments.service.test.ts
 * exercises webhook settlement: this is the delivery-status half of invoice
 * email, and a wrong tenant resolution or a missed idempotency check here has
 * the same blast radius a mis-settled payment would. Needs a migrated, seeded
 * database:
 *   pnpm setup:local && pnpm --filter @platform/sugrpay-api test
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerInput, InvoiceDraftInput } from '@platform/invoicing-contracts';
import type {
  MailDeliveryEvent as PortMailDeliveryEvent,
  MailPort,
  RenderPreviewInput,
  RequestScope,
  SendMailInput,
  SendMailResult,
} from '@platform/kernel';
import { LocalDiskAdapter, loadEnv, getEnv } from '@platform/server';
import { PrismaClient } from '../../database/client.js';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { createFakeQueueService } from '../../../infra/queue/fake-queue.service.js';
import { CustomersService } from '../../customers/application/customers.service.js';
import { InvoicesService } from '../../invoices/application/invoices.service.js';
import type { ZohoPullService } from '../../zoho-sync/application/zoho-pull.service.js';
import { InvoicePdfService } from '../infrastructure/invoice-pdf.service.js';
import { MailEventsService } from './mail-events.service.js';

loadEnv();
const hasDb = Boolean(process.env['INVOICING_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

/** A MailPort whose send() hands back a fresh, test-chosen providerMessageId
 * each time (createFakeMailPort's is fixed, which is fine for tests that
 * never need to correlate a later event back to a specific send, but this
 * one does), and whose verifySignature/parseDeliveryEvent are set per test —
 * exactly the two methods a real webhook controller calls, which is what
 * MailEventsService exercises here without actually standing up HTTP. */
function createScriptedMailPort(): MailPort & {
  nextProviderMessageId: string;
  refuse: Set<string>;
} {
  const port = {
    providerName: 'scripted-fake',
    nextProviderMessageId: 'unset',
    /** Addresses the fake mail server refuses (while accepting the rest). */
    refuse: new Set<string>(),
    send: async (_input: SendMailInput): Promise<SendMailResult> => {
      const all = [..._input.to, ...(_input.cc ?? [])];
      return {
        providerMessageId: port.nextProviderMessageId,
        acceptedAt: new Date(),
        recipients: all.filter((a) => !port.refuse.has(a)),
        rejected: all.filter((a) => port.refuse.has(a)),
      };
    },
    renderPreview: async (input: RenderPreviewInput) => ({ html: input.html }),
    verifySignature: () => true,
    parseDeliveryEvent: (): PortMailDeliveryEvent => {
      throw new Error('parseDeliveryEvent not stubbed for this test');
    },
  };
  return port;
}

describeWithDb('MailEventsService', () => {
  const prisma = new InvoicingPrismaService(env!);
  const mail = createScriptedMailPort();
  const queue = createFakeQueueService();
  const customers = new CustomersService(prisma, queue);
  const invoices = new InvoicesService(
    prisma,
    queue,
    mail,
    env!,
    new LocalDiskAdapter(env!),
    new InvoicePdfService(),
    {} as ZohoPullService,
  );
  const mailEvents = new MailEventsService(mail, prisma);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.INVOICING_DIRECT_DATABASE_URL ?? env!.INVOICING_DATABASE_URL } },
  });

  let brandId = '';
  let customerId = '';
  let ownerScope: RequestScope;

  beforeAll(async () => {
    // Meridian rather than Cobalt/Solstice — several other test files already
    // run concurrently against those two, and dashboard.service.test.ts's own
    // recent-activity assertions are sensitive to interleaved customer
    // creation on the brand it watches.
    const brand = await owner.brand.findFirst({
      where: { displayName: 'Meridian Outfitters' },
      select: { id: true, merchantId: true },
    });
    if (!brand) throw new Error('seed data missing — run pnpm db:seed');
    brandId = brand.id;
    ownerScope = {
      merchantId: brand.merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };

    const customerInput: CustomerInput = {
      type: 'BUSINESS',
      salutation: null,
      firstName: null,
      lastName: null,
      companyName: 'Mail Events Test Co',
      displayName: 'Mail Events Test Co',
      email: 'ap@mail-events-test.example',
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

  async function issuedInvoiceId(): Promise<string> {
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
          unitPrice: '50.00',
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
    return created.id;
  }

  /** Sends the invoice through the real send path (recording the "SENT" row
   * MailEventsService resolves against) and returns the providerMessageId a
   * webhook would reference. */
  async function sentInvoice(): Promise<{ invoiceId: string; providerMessageId: string }> {
    const invoiceId = await issuedInvoiceId();
    const providerMessageId = `pm-${randomUUID()}`;
    mail.nextProviderMessageId = providerMessageId;
    await invoices.sendEmail(ownerScope, brandId, invoiceId, {
      to: 'customer@mail-events-test.example',
      subject: 'Test invoice',
      body: 'Please pay this invoice.',
      attachPdf: false,
    });
    return { invoiceId, providerMessageId };
  }

  it('resolves a bounce back to the invoice and records it on the timeline', async () => {
    const { invoiceId, providerMessageId } = await sentInvoice();
    mail.parseDeliveryEvent = () => ({
      providerMessageId,
      type: 'BOUNCED',
      recipient: 'customer@mail-events-test.example',
      occurredAt: new Date(),
      detail: 'mailbox does not exist',
      bounceKind: 'HARD',
      raw: null,
    });

    await mailEvents.handleWebhook(Buffer.from('{}'), {});

    const mailRow = await owner.mailDeliveryEvent.findFirst({
      where: { providerMessageId, eventType: 'BOUNCED' },
    });
    expect(mailRow?.invoiceId).toBe(invoiceId);
    expect(mailRow?.bounceKind).toBe('HARD');

    const timelineRow = await owner.invoiceEvent.findFirst({
      where: { invoiceId, eventType: 'EMAIL_BOUNCED' },
    });
    expect(timelineRow).not.toBeNull();
    expect((timelineRow?.payload as { bounceKind?: string } | null)?.bounceKind).toBe('HARD');
  });

  it('does not duplicate a webhook redelivered for the same event', async () => {
    const { invoiceId, providerMessageId } = await sentInvoice();
    mail.parseDeliveryEvent = () => ({
      providerMessageId,
      type: 'COMPLAINED',
      recipient: 'customer@mail-events-test.example',
      occurredAt: new Date(),
      detail: null,
      bounceKind: null,
      raw: null,
    });

    await mailEvents.handleWebhook(Buffer.from('{}'), {});
    await mailEvents.handleWebhook(Buffer.from('{}'), {}); // redelivery

    const mailRows = await owner.mailDeliveryEvent.findMany({
      where: { providerMessageId, eventType: 'COMPLAINED' },
    });
    expect(mailRows).toHaveLength(1);

    const timelineRows = await owner.invoiceEvent.findMany({
      where: { invoiceId, eventType: 'EMAIL_COMPLAINED' },
    });
    expect(timelineRows).toHaveLength(1);
  });

  it('ignores an event for a providerMessageId no send ever recorded', async () => {
    mail.parseDeliveryEvent = () => ({
      providerMessageId: 'never-sent',
      type: 'BOUNCED',
      recipient: 'nobody@mail-events-test.example',
      occurredAt: new Date(),
      detail: null,
      bounceKind: 'HARD',
      raw: null,
    });

    // Resolves without throwing — an unattributable event is logged and
    // dropped, the same way PaymentsService.handleWebhook treats one.
    await expect(mailEvents.handleWebhook(Buffer.from('{}'), {})).resolves.toBeUndefined();
  });

  it('rejects a webhook whose signature does not verify', async () => {
    const original = mail.verifySignature;
    mail.verifySignature = () => false;
    try {
      await expect(mailEvents.handleWebhook(Buffer.from('{}'), {})).rejects.toThrow(/signature/i);
    } finally {
      mail.verifySignature = original;
    }
  });

  it('tracks every recipient, To and CC', async () => {
    const invoiceId = await issuedInvoiceId();
    const providerMessageId = `pm-${randomUUID()}`;
    mail.nextProviderMessageId = providerMessageId;
    await invoices.sendEmail(ownerScope, brandId, invoiceId, {
      to: 'customer@mail-events-test.example',
      cc: 'accounts@mail-events-test.example',
      subject: 'Test invoice',
      body: 'Please pay this invoice.',
      attachPdf: false,
    });

    const sent = await owner.mailDeliveryEvent.findMany({
      where: { providerMessageId, eventType: 'SENT' },
      orderBy: { recipient: 'asc' },
    });
    expect(sent.map((row) => row.recipient)).toEqual([
      'accounts@mail-events-test.example',
      'customer@mail-events-test.example',
    ]);
  });

  it('records an address the mail server refused, and puts it on the timeline', async () => {
    const invoiceId = await issuedInvoiceId();
    const providerMessageId = `pm-${randomUUID()}`;
    mail.nextProviderMessageId = providerMessageId;
    mail.refuse.add('typo@mail-events-test.example');
    try {
      const result = await invoices.sendEmail(ownerScope, brandId, invoiceId, {
        to: 'customer@mail-events-test.example',
        cc: 'typo@mail-events-test.example',
        subject: 'Test invoice',
        body: 'Please pay this invoice.',
        attachPdf: false,
      });
      // Sent — the customer got it — with the refused CC reported back.
      expect(result.rejected).toEqual(['typo@mail-events-test.example']);
    } finally {
      mail.refuse.clear();
    }

    const rows = await owner.mailDeliveryEvent.findMany({ where: { providerMessageId } });
    expect(rows.map((row) => [row.eventType, row.recipient]).sort()).toEqual([
      ['REJECTED', 'typo@mail-events-test.example'],
      ['SENT', 'customer@mail-events-test.example'],
    ]);
    const timeline = await owner.invoiceEvent.findFirst({
      where: { invoiceId, eventType: 'EMAIL_REJECTED' },
    });
    expect((timeline?.payload as { recipients?: string[] } | null)?.recipients).toEqual([
      'typo@mail-events-test.example',
    ]);

    // What the merchant sees on the invoice's timeline.
    const activity = await invoices.getActivity(ownerScope, brandId, invoiceId);
    expect(activity.find((e) => e.eventType === 'EMAIL_REJECTED')?.detail).toBe(
      'typo@mail-events-test.example',
    );
  });
});
