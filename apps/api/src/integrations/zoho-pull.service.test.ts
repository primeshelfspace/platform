/**
 * ZohoPullService against a real database — the two things this checks are
 * exactly why the recent optimization work needed to touch the schema, not
 * just the service:
 *
 *  1. Running detail fetches concurrently (mapWithConcurrency) means two of
 *     pullOneInvoice's own cascade calls, or two of pullOnePayment's, can
 *     land on the same not-yet-seen remote contact/invoice in the same
 *     batch — one new customer's invoices both referencing it, or two
 *     partial payments both referencing one new invoice. The
 *     brandId_zohoContactId / brandId_zohoInvoiceId uniqueness plus the
 *     upsert those methods now use is what has to actually resolve that
 *     race, not just look like it does.
 *  2. pullPayments must skip getPayment entirely for a payment already
 *     pulled — that is the whole point of the payment_zoho_payment_id_idx
 *     change; a test that only checked "the counts still come out right"
 *     would not catch a regression back to fetching every payment every time.
 *
 * Needs a migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountingConnection, RequestScope } from '@fenwick/shared';
import { loadEnv } from '../config/load-env.js';
import { getEnv, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import {
  ZohoBooksAdapter,
  type ZohoContactDetail,
  type ZohoContactListItem,
  type ZohoInvoiceDetail,
  type ZohoPaymentDetail,
  type ZohoPaymentListItem,
} from '../adapters/accounting/zoho-books.adapter.js';
import type { IntegrationConnectionService } from './integration-connection.service.js';
import type { SystemScopeResolver } from '../tenancy/system-scope.js';
import { ZohoPullService } from './zoho-pull.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

/**
 * Programmable stand-in for the network calls only. fromZohoAddress,
 * decimalToMinor and reverseMapPaymentMode are the real, pure
 * implementations (inherited, unmodified) — the same ones
 * zoho-books.adapter.test.ts checks directly — so only the methods that
 * actually reach the network here are overridden.
 */
class FakeZohoBooksAdapter extends ZohoBooksAdapter {
  getContactCalls = 0;
  getInvoiceCalls = 0;
  getPaymentCalls = 0;

  readonly contacts = new Map<string, ZohoContactDetail>();
  readonly invoices = new Map<string, ZohoInvoiceDetail>();
  readonly payments = new Map<string, ZohoPaymentDetail>();
  listedContacts: ZohoContactListItem[] = [];
  listedPayments: ZohoPaymentListItem[] = [];

  constructor() {
    super({} as Env, {} as RedisService);
  }

  override async listContactsPage() {
    return { contacts: this.listedContacts, hasMorePage: false };
  }

  override async getContact(_connection: AccountingConnection, contactId: string) {
    this.getContactCalls++;
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error(`no fake contact stubbed for ${contactId}`);
    return contact;
  }

  override async listInvoicesPage() {
    return { invoices: [], hasMorePage: false };
  }

  override async getInvoice(_connection: AccountingConnection, invoiceId: string) {
    this.getInvoiceCalls++;
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`no fake invoice stubbed for ${invoiceId}`);
    return invoice;
  }

  override async listPaymentsPage() {
    return { payments: this.listedPayments, hasMorePage: false };
  }

  override async getPayment(_connection: AccountingConnection, paymentId: string) {
    this.getPaymentCalls++;
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`no fake payment stubbed for ${paymentId}`);
    return payment;
  }
}

function fakeContact(contactId: string, name: string): ZohoContactDetail {
  return {
    contact_id: contactId,
    contact_name: name,
    customer_sub_type: 'business',
  };
}

function fakeInvoice(invoiceId: string, number: string, customerId: string): ZohoInvoiceDetail {
  return {
    invoice_id: invoiceId,
    customer_id: customerId,
    invoice_number: number,
    status: 'sent',
    date: '2026-08-01',
    due_date: '2026-08-31',
    currency_code: 'USD',
    total: 100,
    balance: 100,
    sub_total: 100,
    tax_total: 0,
    line_items: [{ name: 'Widget', rate: 100, quantity: 1 }],
  };
}

function fakePayment(paymentId: string, customerId: string, invoiceId: string): ZohoPaymentDetail {
  return {
    payment_id: paymentId,
    date: '2026-08-05',
    payment_mode: 'banktransfer',
    amount: 100,
    customer_id: customerId,
    invoices: [{ invoice_id: invoiceId, amount_applied: 100 }],
  };
}

describeWithDb('ZohoPullService', () => {
  const prisma = new PrismaService(env!);
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  const redis = new RedisService(env!);

  let brandId = '';
  let scope: RequestScope;
  let connection: AccountingConnection;

  beforeAll(async () => {
    const brand = await owner.brand.findFirst({
      where: { displayName: 'Meridian Outfitters' },
      select: { id: true, merchantId: true },
    });
    if (!brand) throw new Error('seed data missing — run pnpm db:seed');
    brandId = brand.id;
    scope = {
      merchantId: brand.merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };
    connection = {
      brandId,
      organisationId: 'test-org',
      accessToken: 'test-token',
      refreshToken: null,
      expiresAt: null,
    };
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect(), redis.onModuleDestroy()]);
  });

  /** ZohoPullService's own pull* methods are private — reached directly
   * here rather than through the public pullBrand, which would also need a
   * real IntegrationConnectionService/SystemScopeResolver wired to a stored
   * connection. Casting past that is the standard way to unit-test an
   * internal method with no other seam. */
  function service(zoho: FakeZohoBooksAdapter, redis: RedisService = {} as RedisService) {
    return new ZohoPullService(
      prisma,
      zoho,
      {} as IntegrationConnectionService,
      {} as SystemScopeResolver,
      redis,
    ) as unknown as {
      pullCustomersIfDue: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        cursor: Date | null,
        force: boolean,
      ) => Promise<number>;
      pullOneCustomer: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        contactId: string,
      ) => Promise<void>;
      pullOneInvoice: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        invoiceId: string,
      ) => Promise<void>;
      pullOnePayment: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        paymentId: string,
      ) => Promise<boolean>;
      pullPayments: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
      ) => Promise<number>;
    };
  }

  it('resolves two invoices racing to create the same not-yet-seen customer into exactly one row', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `race-contact-${randomUUID()}`;
    const invoiceIdA = `race-invoice-a-${randomUUID()}`;
    const invoiceIdB = `race-invoice-b-${randomUUID()}`;

    zoho.contacts.set(contactId, fakeContact(contactId, 'Race Test Co'));
    // A fresh randomUUID() slice, not invoiceIdA/B's own — those are prefixed
    // ("race-invoice-a-...") for readability, so slicing *them* just returns
    // the fixed literal prefix every run, not anything unique, which quietly
    // collided the invoice_brand_id_number_key constraint against whatever
    // this same test had left behind from an earlier run.
    zoho.invoices.set(
      invoiceIdA,
      fakeInvoice(invoiceIdA, `INV-A-${randomUUID().slice(0, 8)}`, contactId),
    );
    zoho.invoices.set(
      invoiceIdB,
      fakeInvoice(invoiceIdB, `INV-B-${randomUUID().slice(0, 8)}`, contactId),
    );

    const svc = service(zoho);
    await Promise.all([
      svc.pullOneInvoice(scope, brandId, connection, invoiceIdA),
      svc.pullOneInvoice(scope, brandId, connection, invoiceIdB),
    ]);

    const customers = await owner.customer.findMany({
      where: { brandId, zohoContactId: contactId },
    });
    expect(customers).toHaveLength(1);

    const invoices = await owner.invoice.findMany({
      where: { brandId, zohoInvoiceId: { in: [invoiceIdA, invoiceIdB] } },
    });
    expect(invoices).toHaveLength(2);
    expect(invoices.every((i) => i.customerId === customers[0]!.id)).toBe(true);
  });

  it('resolves two payments racing to create the same not-yet-seen invoice into exactly one row', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `race-contact-${randomUUID()}`;
    const invoiceId = `race-invoice-${randomUUID()}`;
    const paymentIdA = `race-payment-a-${randomUUID()}`;
    const paymentIdB = `race-payment-b-${randomUUID()}`;

    zoho.contacts.set(contactId, fakeContact(contactId, 'Race Test Co 2'));
    zoho.invoices.set(
      invoiceId,
      fakeInvoice(invoiceId, `INV-C-${randomUUID().slice(0, 8)}`, contactId),
    );
    zoho.payments.set(paymentIdA, fakePayment(paymentIdA, contactId, invoiceId));
    zoho.payments.set(paymentIdB, fakePayment(paymentIdB, contactId, invoiceId));

    const svc = service(zoho);
    const applied = await Promise.all([
      svc.pullOnePayment(scope, brandId, connection, paymentIdA),
      svc.pullOnePayment(scope, brandId, connection, paymentIdB),
    ]);
    expect(applied).toEqual([true, true]);

    const invoices = await owner.invoice.findMany({ where: { brandId, zohoInvoiceId: invoiceId } });
    expect(invoices).toHaveLength(1);

    const payments = await owner.payment.findMany({
      where: { brandId, zohoPaymentId: { in: [paymentIdA, paymentIdB] } },
    });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.invoiceId === invoices[0]!.id)).toBe(true);
  });

  it('skips getPayment entirely for a payment already pulled', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `skip-contact-${randomUUID()}`;
    const invoiceId = `skip-invoice-${randomUUID()}`;
    const paymentId = `skip-payment-${randomUUID()}`;

    zoho.contacts.set(contactId, fakeContact(contactId, 'Skip Test Co'));
    zoho.invoices.set(
      invoiceId,
      fakeInvoice(invoiceId, `INV-D-${randomUUID().slice(0, 8)}`, contactId),
    );
    zoho.payments.set(paymentId, fakePayment(paymentId, contactId, invoiceId));
    zoho.listedPayments = [
      { payment_id: paymentId, date: '2026-08-05', payment_mode: 'banktransfer', amount: 100 },
    ];

    const svc = service(zoho);

    const firstRunTouched = await svc.pullPayments(scope, brandId, connection);
    expect(firstRunTouched).toBe(1);
    expect(zoho.getPaymentCalls).toBe(1);

    const secondRunTouched = await svc.pullPayments(scope, brandId, connection);
    expect(secondRunTouched).toBe(0);
    // The regression this guards against: without the already-pulled check,
    // this would be 2 — every payment re-fetched on every single pull.
    expect(zoho.getPaymentCalls).toBe(1);
  });

  it('floors the full contacts scan, but a forced pull always bypasses it', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `floor-contact-${randomUUID()}`;
    zoho.contacts.set(contactId, fakeContact(contactId, 'Floor Test Co'));
    zoho.listedContacts = [{ contact_id: contactId, contact_name: 'Floor Test Co' }];

    // Same key ZohoPullService.pullCustomersIfDue uses — cleared first so an
    // earlier run against this same seeded brand can't leave the floor set.
    const floorKey = `zoho:contacts-scanned:${brandId}`;
    await redis.invalidate(floorKey);

    const svc = service(zoho, redis);

    const first = await svc.pullCustomersIfDue(scope, brandId, connection, null, false);
    expect(first).toBe(1);
    expect(zoho.getContactCalls).toBe(1);

    // Same brand, unforced, immediately after — the scan is floored, so this
    // must not touch Zoho again.
    const second = await svc.pullCustomersIfDue(scope, brandId, connection, null, false);
    expect(second).toBe(0);
    expect(zoho.getContactCalls).toBe(1);

    // force: true is what the on-demand "pull now" endpoint sets — it must
    // get a real scan even though the floor is still active.
    const third = await svc.pullCustomersIfDue(scope, brandId, connection, null, true);
    expect(third).toBe(1);
    expect(zoho.getContactCalls).toBe(2);

    await redis.invalidate(floorKey);
  });
});
