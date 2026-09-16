/**
 * InvoicesService against a real database (TDD-001 §9.4, §5.3). Needs a
 * migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerInput, InvoiceDraftInput, RequestScope } from '@fenwick/shared';
import { createFakeMailPort } from '../adapters/mail/fake-mail.port.js';
import { LocalDiskAdapter } from '../adapters/storage/local-disk.adapter.js';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { createFakeQueueService } from '../infra/queue/fake-queue.service.js';
import { CustomersService } from '../customers/customers.service.js';
import type { ZohoPullService } from '../integrations/zoho-pull.service.js';
import { InvoicePdfService } from '../public/invoice-pdf.service.js';
import { InvoicesService } from './invoices.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('InvoicesService', () => {
  const prisma = new PrismaService(env!);
  const queue = createFakeQueueService();
  const customers = new CustomersService(prisma, queue);
  const mail = createFakeMailPort();
  // No onModuleInit call — fine as long as no test here exercises
  // attachPdf: true, which is the only path that touches the browser.
  const invoices = new InvoicesService(
    prisma,
    queue,
    mail,
    env!,
    new LocalDiskAdapter(env!),
    new InvoicePdfService(),
    // No test here creates a Zoho-sourced invoice, so findOne's on-demand
    // enrichment branch never fires — a real ZohoPullService (OAuth
    // connection, rate limiting, ...) would be pure overhead.
    {} as ZohoPullService,
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let merchantId = '';
  let solsticeId = '';
  let northgateId = '';
  let ownerScope: RequestScope;
  let customerWithEmailId = '';
  let customerWithoutEmailId = '';

  beforeAll(async () => {
    const solstice = await owner.brand.findFirst({
      where: { displayName: 'Cobalt Studio Supply' },
      select: { id: true, merchantId: true },
    });
    const northgate = await owner.brand.findFirst({
      where: { displayName: 'Northgate' },
      select: { id: true },
    });
    if (!solstice || !northgate) throw new Error('seed data missing — run pnpm db:seed');
    solsticeId = solstice.id;
    merchantId = solstice.merchantId;
    northgateId = northgate.id;
    ownerScope = {
      merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };

    const base: Omit<CustomerInput, 'email' | 'displayName'> = {
      type: 'BUSINESS',
      salutation: null,
      firstName: null,
      lastName: null,
      companyName: 'Invoices Test Co',
      phone: null,
      billingAddress: null,
      shippingAddress: null,
    };
    customerWithEmailId = (
      await customers.create(ownerScope, solsticeId, {
        ...base,
        displayName: 'Invoices Test Co (with email)',
        email: 'ap@invoices-test.example',
      })
    ).id;
    customerWithoutEmailId = (
      await customers.create(ownerScope, solsticeId, {
        ...base,
        displayName: 'Invoices Test Co (no email)',
        email: null,
      })
    ).id;
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  function draft(overrides: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput {
    return {
      brandId: solsticeId,
      customerId: customerWithEmailId,
      invoiceDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      currency: 'USD',
      lines: [
        {
          itemName: 'Cast-iron cookware set',
          description: null,
          quantity: '12',
          unitPrice: '200.00',
          taxExempt: false,
        },
        {
          itemName: 'Ceramic bakeware bundle',
          description: null,
          quantity: '6',
          unitPrice: '120.00',
          taxExempt: false,
        },
      ],
      taxRateBp: 600,
      cardFeeRateBp: 290,
      notes: null,
      internalNotes: null,
      ...overrides,
    };
  }

  it('computes subtotal, tax and a fee-exempt total matching CalculationService exactly', async () => {
    const created = await invoices.create(ownerScope, solsticeId, draft());

    // 12×200.00 + 6×120.00 = 3120.00; 6% tax = 187.20; MANUAL baseline carries no fee.
    expect(created.subtotalMinor).toBe(312000n);
    expect(created.taxMinor).toBe(18720n);
    expect(created.cardFeeMinor).toBe(0n);
    expect(created.totalMinor).toBe(330720n);
    expect(created.balanceMinor).toBe(330720n);
    expect(created.status).toBe('DRAFT');
    expect(created.lineItems).toHaveLength(2);
    expect(created.lineItems[0]?.lineTotalMinor).toBe(240000n);
    expect(created.lineItems[1]?.lineTotalMinor).toBe(72000n);
  });

  it('freezes the brand-current tax and fee rate onto the invoice at creation', async () => {
    const created = await invoices.create(
      ownerScope,
      solsticeId,
      draft({ taxRateBp: 825, cardFeeRateBp: 350 }),
    );
    expect(created.taxRateBpApplied).toBe(825);
    expect(created.cardFeeRateBpApplied).toBe(350);
  });

  it('allocates a unique, brand-prefixed, sequential number even under concurrent creation', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => invoices.create(ownerScope, solsticeId, draft())),
    );
    const numbers = results.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length); // no collisions
    // Prefix is whatever this brand's seed data set it to — the property
    // under test is uniqueness and sequencing, not which brand it is.
    for (const number of numbers) expect(number).toMatch(/^[A-Z]+-\d{4}$/);
  });

  it('issues a valid draft: status becomes SENT and issuedAt is stamped', async () => {
    const created = await invoices.create(ownerScope, solsticeId, draft());
    const issued = await invoices.issue(ownerScope, solsticeId, created.id);
    expect(issued.status).toBe('SENT');
    expect(issued.issuedAt).not.toBeNull();
  });

  it('refuses to issue an invoice for a customer with no deliverable email', async () => {
    const created = await invoices.create(
      ownerScope,
      solsticeId,
      draft({ customerId: customerWithoutEmailId }),
    );
    await expect(invoices.issue(ownerScope, solsticeId, created.id)).rejects.toThrow(
      ConflictException,
    );

    const row = await owner.invoice.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('DRAFT'); // refused, not half-applied
  });

  it('refuses to issue an invoice that is not in Draft', async () => {
    const created = await invoices.create(ownerScope, solsticeId, draft());
    await invoices.issue(ownerScope, solsticeId, created.id);
    await expect(invoices.issue(ownerScope, solsticeId, created.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it("never returns another brand's invoice, even by exact id", async () => {
    const created = await invoices.create(ownerScope, solsticeId, draft());
    await expect(invoices.findOne(ownerScope, northgateId, created.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects creating an invoice against another brand's customer", async () => {
    await expect(
      invoices.create(ownerScope, northgateId, draft({ customerId: customerWithEmailId })),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a role with no brand assignment reaching a brand it is not assigned to', async () => {
    const salesUser: RequestScope = {
      merchantId,
      userId: 'sales-user',
      role: 'SALES_USER',
      assignedBrandIds: [northgateId], // Solstice explicitly excluded
      sessionId: 'test-session',
      sourceIp: null,
    };
    // RLS returns "not found" rather than a distinguishable "forbidden" —
    // deliberately, so a probe cannot tell scope-denial from non-existence.
    // The list is paginated now, so the assertion is on its rows rather than
    // the response envelope — the property under test is unchanged: RLS makes
    // another brand's invoices return nothing at all.
    const denied = await invoices.list(salesUser, solsticeId, { page: 1, pageSize: 25 });
    expect(denied.data).toEqual([]);
    expect(denied.total).toBe(0);
  });

  // The point of Brand Settings > Branding is that a customer's email looks
  // like the brand's, so these assert the send actually reads it — the
  // layout, colours and logo were stored and then ignored before this.
  describe("email send honours the brand's Branding settings", () => {
    // These rewrite the seed brand's branding columns, so the originals go
    // back afterwards — a test run must leave the database as it found it.
    let original: { emailReceiptLayout: string; accentColor: string };

    beforeAll(async () => {
      const row = await owner.brandSettings.findUniqueOrThrow({ where: { brandId: solsticeId } });
      original = { emailReceiptLayout: row.emailReceiptLayout, accentColor: row.accentColor };
    });

    afterAll(async () => {
      await owner.brandSettings.update({
        where: { brandId: solsticeId },
        data: original as {
          emailReceiptLayout: 'CLASSIC' | 'HERO' | 'MINIMAL';
          accentColor: string;
        },
      });
    });

    async function sentHtmlFor(overrides: {
      emailReceiptLayout?: 'CLASSIC' | 'HERO' | 'MINIMAL';
      accentColor?: string;
    }): Promise<string> {
      await owner.brandSettings.update({ where: { brandId: solsticeId }, data: overrides });
      const created = await invoices.create(ownerScope, solsticeId, draft());
      const invoice = await invoices.issue(ownerScope, solsticeId, created.id);

      mail.outbox.length = 0;
      await invoices.sendEmail(ownerScope, solsticeId, invoice.id, {
        to: 'ap@example.com',
        subject: 'Your invoice',
        body: 'Please pay.',
      });

      const sent = mail.outbox.at(-1);
      if (!sent) throw new Error('nothing was sent');
      return sent.html;
    }

    it('uses the accent colour on the pay button', async () => {
      const html = await sentHtmlFor({ accentColor: '#CC0066' });
      expect(html).toContain('background:#CC0066');
    });

    it('uses the layout the brand chose', async () => {
      const hero = await sentHtmlFor({ emailReceiptLayout: 'HERO' });
      expect(hero).toContain('text-align:center;');

      const minimal = await sentHtmlFor({ emailReceiptLayout: 'MINIMAL' });
      expect(minimal).toContain('width:40px;height:6px');
    });

    it('carries the merchant-reviewed subject into the body, not just the header', async () => {
      const html = await sentHtmlFor({});
      expect(html).toContain('Your invoice');
      expect(html).toContain('Please pay.');
    });
  });

  describe('sendEmail preferredMethod', () => {
    it('carries ?method= on the payment link when a preferred method is given', async () => {
      const created = await invoices.create(ownerScope, solsticeId, draft());
      const invoice = await invoices.issue(ownerScope, solsticeId, created.id);

      mail.outbox.length = 0;
      await invoices.sendEmail(ownerScope, solsticeId, invoice.id, {
        to: 'ap@example.com',
        subject: 'Your invoice',
        body: 'Please pay.',
        preferredMethod: 'ACH',
      });

      const sent = mail.outbox.at(-1);
      if (!sent) throw new Error('nothing was sent');
      expect(sent.html).toContain(`/i/${invoice.publicToken}?method=ACH`);
    });

    it('omits ?method= entirely when no preference is given', async () => {
      const created = await invoices.create(ownerScope, solsticeId, draft());
      const invoice = await invoices.issue(ownerScope, solsticeId, created.id);

      mail.outbox.length = 0;
      await invoices.sendEmail(ownerScope, solsticeId, invoice.id, {
        to: 'ap@example.com',
        subject: 'Your invoice',
        body: 'Please pay.',
      });

      const sent = mail.outbox.at(-1);
      if (!sent) throw new Error('nothing was sent');
      expect(sent.html).toContain(`/i/${invoice.publicToken}"`);
      expect(sent.html).not.toContain('?method=');
    });
  });

  describe('bulkSend', () => {
    // Each invoice chains issue + prepareEmail + sendEmail — several times
    // more DB round trips than this file's usual single-call tests, and this
    // suite's own vitest.config already notes a cold Neon connection can take
    // up to 4.5s on its own; two invoices sequentially can outrun the 30s
    // default, hence the raised timeout below.
    it('issues each draft and sends it, returning every id in `sent`', async () => {
      const a = await invoices.create(ownerScope, solsticeId, draft());
      const b = await invoices.create(ownerScope, solsticeId, draft());

      mail.outbox.length = 0;
      const result = await invoices.bulkSend(ownerScope, solsticeId, [a.id, b.id]);

      expect(result.sent.sort()).toEqual([a.id, b.id].sort());
      expect(result.skipped).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(mail.outbox).toHaveLength(2);

      const rowA = await owner.invoice.findUniqueOrThrow({ where: { id: a.id } });
      expect(rowA.status).toBe('SENT'); // draft -> sent, same as a first send from the drawer
    }, 90_000);

    it('resends an already-issued invoice without re-issuing it', async () => {
      const created = await invoices.create(ownerScope, solsticeId, draft());
      const issued = await invoices.issue(ownerScope, solsticeId, created.id);

      mail.outbox.length = 0;
      const result = await invoices.bulkSend(ownerScope, solsticeId, [issued.id]);

      expect(result.sent).toEqual([issued.id]);
      expect(mail.outbox).toHaveLength(1);
    }, 60_000);

    it('skips a customer with no email on file, rather than failing the batch', async () => {
      const sendable = await invoices.create(ownerScope, solsticeId, draft());
      const noEmail = await invoices.create(
        ownerScope,
        solsticeId,
        draft({ customerId: customerWithoutEmailId }),
      );

      mail.outbox.length = 0;
      const result = await invoices.bulkSend(ownerScope, solsticeId, [sendable.id, noEmail.id]);

      expect(result.sent).toEqual([sendable.id]);
      expect(result.skipped).toEqual([
        { id: noEmail.id, reason: 'Customer has no email on file.' },
      ]);
      expect(mail.outbox).toHaveLength(1);
    }, 60_000);

    it('skips an already-paid or cancelled invoice', async () => {
      const paid = await invoices.create(ownerScope, solsticeId, draft());
      await invoices.issue(ownerScope, solsticeId, paid.id);
      await owner.invoice.update({ where: { id: paid.id }, data: { status: 'PAID' } });

      const cancelled = await invoices.create(ownerScope, solsticeId, draft());
      await owner.invoice.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });

      mail.outbox.length = 0;
      const result = await invoices.bulkSend(ownerScope, solsticeId, [paid.id, cancelled.id]);

      expect(result.sent).toEqual([]);
      expect(result.skipped.map((s) => s.id).sort()).toEqual([cancelled.id, paid.id].sort());
      expect(mail.outbox).toHaveLength(0);
    });

    it('reports a missing id as failed rather than throwing', async () => {
      const result = await invoices.bulkSend(ownerScope, solsticeId, [
        '00000000-0000-0000-0000-000000000000',
      ]);
      expect(result.sent).toEqual([]);
      expect(result.failed).toEqual([
        { id: '00000000-0000-0000-0000-000000000000', reason: 'Invoice not found.' },
      ]);
    });
  });
});
