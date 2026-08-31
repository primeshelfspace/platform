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
import { IntegrationError } from '@fenwick/shared';
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
  type ZohoInvoiceListItem,
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
  /** Drives reconcileInvoicePresence's full scan. Empty by default, which is
   * what every pre-existing test already assumed. */
  listedInvoices: ZohoInvoiceListItem[] = [];

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
    return { invoices: this.listedInvoices, hasMorePage: false };
  }

  /** Lets a test make the detail fetch itself fail, to exercise how a phase
   * reacts to a systemic error rather than a bad record. */
  getInvoiceImpl: ((invoiceId: string) => ZohoInvoiceDetail) | undefined;

  override async getInvoice(_connection: AccountingConnection, invoiceId: string) {
    this.getInvoiceCalls++;
    if (this.getInvoiceImpl) return this.getInvoiceImpl(invoiceId);
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

function fakeContact(
  contactId: string,
  name: string,
  contactPersons: ZohoContactDetail['contact_persons'] = [],
): ZohoContactDetail {
  return {
    contact_id: contactId,
    contact_name: name,
    customer_sub_type: 'business',
    contact_persons: contactPersons,
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
      ) => Promise<boolean>;
      pullOneInvoice: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        invoiceId: string,
      ) => Promise<boolean>;
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
      pullPaymentsIfDue: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        force: boolean,
      ) => Promise<number>;
      reconcileInvoicePresence: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
      ) => Promise<void>;
      pullInvoices: (
        scope: RequestScope,
        brandId: string,
        connection: AccountingConnection,
        cursor: Date | null,
      ) => Promise<number>;
      reconcileContactPresence: (
        scope: RequestScope,
        brandId: string,
        seen: ReadonlyArray<{ contactId: string; status: string | undefined }>,
      ) => Promise<void>;
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

  it('floors the full payments scan, but a forced pull always bypasses it', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `pay-floor-contact-${randomUUID()}`;
    const invoiceId = `pay-floor-invoice-${randomUUID()}`;
    const paymentId = `pay-floor-payment-${randomUUID()}`;

    zoho.contacts.set(contactId, fakeContact(contactId, 'Payment Floor Test Co'));
    zoho.invoices.set(
      invoiceId,
      fakeInvoice(invoiceId, `INV-PF-${randomUUID().slice(0, 8)}`, contactId),
    );
    zoho.payments.set(paymentId, fakePayment(paymentId, contactId, invoiceId));
    zoho.listedPayments = [
      { payment_id: paymentId, date: '2026-08-05', payment_mode: 'banktransfer', amount: 100 },
    ];

    // Same key ZohoPullService.pullPaymentsIfDue uses — cleared first so an
    // earlier run against this same seeded brand can't leave the floor set.
    const floorKey = `zoho:payments-scanned:${brandId}`;
    await redis.invalidate(floorKey);

    const svc = service(zoho, redis);

    const first = await svc.pullPaymentsIfDue(scope, brandId, connection, false);
    expect(first).toBe(1);
    expect(zoho.getPaymentCalls).toBe(1);

    // Same brand, unforced, immediately after — the scan is floored, so this
    // must not touch Zoho again (no listPaymentsPage call either, but that's
    // only observable indirectly here via getPaymentCalls staying put).
    const second = await svc.pullPaymentsIfDue(scope, brandId, connection, false);
    expect(second).toBe(0);
    expect(zoho.getPaymentCalls).toBe(1);

    // force: true is what the on-demand "pull now" endpoint sets — it must
    // get a real scan even though the floor is still active. The payment was
    // already pulled above, so this re-scans but finds nothing new to fetch.
    const third = await svc.pullPaymentsIfDue(scope, brandId, connection, true);
    expect(third).toBe(0);
    expect(zoho.getPaymentCalls).toBe(1);

    await redis.invalidate(floorKey);
  });

  it('archives a customer whose Zoho contact is inactive, and re-activates it if Zoho flips back', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `status-contact-${randomUUID()}`;
    zoho.contacts.set(contactId, {
      ...fakeContact(contactId, 'Status Test Co'),
      status: 'inactive',
    });

    const svc = service(zoho);
    await svc.pullOneCustomer(scope, brandId, connection, contactId);

    let customer = await owner.customer.findFirst({ where: { brandId, zohoContactId: contactId } });
    expect(customer?.status).toBe('ARCHIVED');

    // Zoho flips the contact back to active on a re-pull — status must
    // follow it back, not stay stuck archived.
    zoho.contacts.set(contactId, {
      ...fakeContact(contactId, 'Status Test Co'),
      status: 'active',
    });
    await svc.pullOneCustomer(scope, brandId, connection, contactId);

    customer = await owner.customer.findFirst({ where: { brandId, zohoContactId: contactId } });
    expect(customer?.status).toBe('ACTIVE');
  });

  it('pulls contact persons, then updates and trims them on a re-pull', async () => {
    const zoho = new FakeZohoBooksAdapter();
    const contactId = `persons-contact-${randomUUID()}`;
    zoho.contacts.set(
      contactId,
      fakeContact(contactId, 'Persons Test Co', [
        {
          contact_person_id: 'cp-keep',
          first_name: 'Alex',
          last_name: 'Rivera',
          email: 'alex@example.com',
          designation: 'Controller',
          is_primary_contact: true,
        },
        {
          contact_person_id: 'cp-drop',
          first_name: 'Sam',
          last_name: 'Lee',
          email: 'sam@example.com',
        },
      ]),
    );

    const svc = service(zoho);
    await svc.pullOneCustomer(scope, brandId, connection, contactId);

    const customer = await owner.customer.findFirst({
      where: { brandId, zohoContactId: contactId },
    });
    let persons = await owner.customerContactPerson.findMany({
      where: { customerId: customer!.id },
      orderBy: { zohoContactPersonId: 'asc' },
    });
    expect(persons.map((p) => p.zohoContactPersonId)).toEqual(['cp-drop', 'cp-keep']);
    const keep = persons.find((p) => p.zohoContactPersonId === 'cp-keep')!;
    expect(keep.firstName).toBe('Alex');
    expect(keep.designation).toBe('Controller');
    expect(keep.isPrimaryContact).toBe(true);

    // Re-pull with cp-keep's designation changed, cp-drop gone, and a
    // brand-new cp-new added — exercises update, trim, and insert all in
    // the same pass.
    zoho.contacts.set(
      contactId,
      fakeContact(contactId, 'Persons Test Co', [
        {
          contact_person_id: 'cp-keep',
          first_name: 'Alex',
          last_name: 'Rivera',
          email: 'alex@example.com',
          designation: 'VP Finance',
          is_primary_contact: true,
        },
        { contact_person_id: 'cp-new', first_name: 'Priya', last_name: 'Nair' },
      ]),
    );
    await svc.pullOneCustomer(scope, brandId, connection, contactId);

    persons = await owner.customerContactPerson.findMany({
      where: { customerId: customer!.id },
      orderBy: { zohoContactPersonId: 'asc' },
    });
    expect(persons.map((p) => p.zohoContactPersonId)).toEqual(['cp-keep', 'cp-new']);
    expect(persons.find((p) => p.zohoContactPersonId === 'cp-keep')!.designation).toBe(
      'VP Finance',
    );
  });

  /**
   * Echo suppression (Invoice.zohoSyncedVersion). These two are the regression
   * guards for the round-trip corruption: push and pull were each correct on
   * their own but were not inverse operations, so composing them destroyed the
   * invoice's own arithmetic. The first case is what used to break; the second
   * exists so the fix cannot be "stop pulling invoices", which would be a far
   * worse bug than the one being fixed.
   */
  describe('push/pull echo suppression', () => {
    /** A locally-issued invoice as it looks here: tax and card fee are their
     * own fields, one line item. Plus the shape Zoho reports for that same
     * invoice after our push turned tax and the fee into ordinary lines. */
    async function localInvoicePushedToZoho(zohoInvoiceId: string, syncedVersion: Date) {
      const contactId = `echo-contact-${randomUUID()}`;
      const customer = await owner.customer.create({
        data: {
          brandId,
          type: 'BUSINESS',
          displayName: 'Echo Test Co',
          firstName: 'Dana',
          lastName: 'Whitfield',
          zohoContactId: contactId,
        },
      });
      const invoice = await owner.invoice.create({
        data: {
          brandId,
          customerId: customer.id,
          number: `ECHO-${randomUUID().slice(0, 8)}`,
          status: 'SENT',
          invoiceDate: new Date('2026-08-01'),
          dueDate: new Date('2026-08-31'),
          currency: 'USD',
          subtotalMinor: 10000n,
          taxRateBpApplied: 800,
          taxMinor: 800n,
          cardFeeRateBpApplied: 300,
          cardFeeMinor: 300n,
          totalMinor: 11100n,
          balanceMinor: 11100n,
          publicToken: randomUUID().replace(/-/g, ''),
          zohoInvoiceId,
          zohoSyncedVersion: syncedVersion,
        },
      });
      await owner.lineItem.create({
        data: {
          invoiceId: invoice.id,
          position: 0,
          itemName: 'Consulting',
          quantity: 10000,
          unitPriceMinor: 10000n,
          lineTotalMinor: 10000n,
          taxExempt: false,
        },
      });
      return { customer, invoice, contactId };
    }

    /** What Zoho holds after pushInvoice appended tax and the card fee as
     * plain line items: one invoice whose sub_total is our grand total, with
     * no tax of its own. Applying this verbatim is the corruption. */
    function zohoViewOfPushedInvoice(
      zohoInvoiceId: string,
      contactId: string,
      number: string,
      lastModified: string,
    ): ZohoInvoiceDetail {
      return {
        invoice_id: zohoInvoiceId,
        customer_id: contactId,
        invoice_number: number,
        status: 'sent',
        date: '2026-08-01',
        due_date: '2026-08-31',
        currency_code: 'USD',
        total: 111,
        balance: 111,
        sub_total: 111,
        tax_total: 0,
        last_modified_time: lastModified,
        line_items: [
          { name: 'Consulting', rate: 100, quantity: 1 },
          { name: 'Tax', rate: 8, quantity: 1 },
          { name: 'Card processing fee', rate: 3, quantity: 1 },
        ],
      };
    }

    it('leaves an invoice untouched when Zoho reports nothing newer than our own push', async () => {
      const zohoInvoiceId = `echo-invoice-${randomUUID()}`;
      const pushedAt = new Date('2026-08-20T10:00:00.000Z');
      const { invoice, contactId } = await localInvoicePushedToZoho(zohoInvoiceId, pushedAt);

      const zoho = new FakeZohoBooksAdapter();
      zoho.invoices.set(
        zohoInvoiceId,
        // Exactly equal to the stored version — an unchanged record reports the
        // timestamp of our own write, which is why the check is <= and not <.
        zohoViewOfPushedInvoice(zohoInvoiceId, contactId, invoice.number, pushedAt.toISOString()),
      );

      const applied = await service(zoho).pullOneInvoice(scope, brandId, connection, zohoInvoiceId);
      expect(applied).toBe(false);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      // Every one of these was corrupted before the fix: subtotal absorbed the
      // tax and the fee, tax was zeroed, and cardFeeMinor survived to be
      // counted a second time.
      expect(after.subtotalMinor).toBe(10000n);
      expect(after.taxMinor).toBe(800n);
      expect(after.taxRateBpApplied).toBe(800);
      expect(after.cardFeeMinor).toBe(300n);
      expect(after.totalMinor).toBe(11100n);

      const lines = await owner.lineItem.findMany({ where: { invoiceId: invoice.id } });
      expect(lines).toHaveLength(1);
      expect(lines[0]!.taxExempt).toBe(false);
    });

    it('still applies a genuine Zoho edit made after our push', async () => {
      const zohoInvoiceId = `real-edit-invoice-${randomUUID()}`;
      const pushedAt = new Date('2026-08-20T10:00:00.000Z');
      const { invoice, contactId } = await localInvoicePushedToZoho(zohoInvoiceId, pushedAt);

      const zoho = new FakeZohoBooksAdapter();
      zoho.invoices.set(zohoInvoiceId, {
        ...zohoViewOfPushedInvoice(
          zohoInvoiceId,
          contactId,
          invoice.number,
          // An hour later: somebody actually changed this in Zoho, so Zoho is
          // authoritative and the pull must overwrite.
          new Date(pushedAt.getTime() + 3_600_000).toISOString(),
        ),
        total: 250,
        balance: 250,
        sub_total: 200,
        tax_total: 50,
        line_items: [{ name: 'Revised consulting', rate: 200, quantity: 1 }],
      });

      const applied = await service(zoho).pullOneInvoice(scope, brandId, connection, zohoInvoiceId);
      expect(applied).toBe(true);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.subtotalMinor).toBe(20000n);
      expect(after.taxMinor).toBe(5000n);
      expect(after.totalMinor).toBe(25000n);

      const lines = await owner.lineItem.findMany({ where: { invoiceId: invoice.id } });
      expect(lines).toHaveLength(1);
      expect(lines[0]!.itemName).toBe('Revised consulting');
    });

    it("preserves a customer's first and last name against an echo of our own push", async () => {
      const contactId = `echo-cust-${randomUUID()}`;
      const pushedAt = new Date('2026-08-20T10:00:00.000Z');
      const customer = await owner.customer.create({
        data: {
          brandId,
          type: 'BUSINESS',
          displayName: 'Echo Person Co',
          firstName: 'Dana',
          lastName: 'Whitfield',
          zohoContactId: contactId,
          zohoSyncedVersion: pushedAt,
        },
      });

      // upsertCustomer sends only contact_name, so Zoho has no first/last name
      // to report back. Applying this echo blanked both fields locally.
      const zoho = new FakeZohoBooksAdapter();
      zoho.contacts.set(contactId, {
        ...fakeContact(contactId, 'Echo Person Co'),
        last_modified_time: pushedAt.toISOString(),
      });

      const svc = service(zoho);
      expect(await svc.pullOneCustomer(scope, brandId, connection, contactId)).toBe(false);

      let after = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.firstName).toBe('Dana');
      expect(after.lastName).toBe('Whitfield');

      // A real rename in Zoho after the push still wins, as it must.
      zoho.contacts.set(contactId, {
        ...fakeContact(contactId, 'Renamed In Zoho Ltd'),
        last_modified_time: new Date(pushedAt.getTime() + 3_600_000).toISOString(),
      });
      expect(await svc.pullOneCustomer(scope, brandId, connection, contactId)).toBe(true);

      after = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.displayName).toBe('Renamed In Zoho Ltd');
    });

    it('applies a pull normally for a record this platform never pushed', async () => {
      // The null-version path: a Zoho-originated contact has no stored version,
      // which must read as "not an echo" rather than accidentally suppressing
      // every inbound record.
      const contactId = `never-pushed-${randomUUID()}`;
      const zoho = new FakeZohoBooksAdapter();
      zoho.contacts.set(contactId, {
        ...fakeContact(contactId, 'Never Pushed Co'),
        last_modified_time: new Date('2026-08-20T10:00:00.000Z').toISOString(),
      });

      expect(await service(zoho).pullOneCustomer(scope, brandId, connection, contactId)).toBe(true);
      const created = await owner.customer.findFirst({
        where: { brandId, zohoContactId: contactId },
      });
      expect(created?.displayName).toBe('Never Pushed Co');
    });
  });

  /**
   * Deletion reconciliation (G-02 / G-09). Neither pipeline could previously see
   * a deletion: the invoice pull is incremental, so an invoice removed from Zoho
   * just stopped being mentioned and its payment link stayed live here.
   */
  describe('deletion reconciliation', () => {
    async function zohoSourcedInvoice(opts: { createdAt: Date }) {
      const contactId = `recon-contact-${randomUUID()}`;
      const customer = await owner.customer.create({
        data: {
          brandId,
          type: 'BUSINESS',
          displayName: 'Reconcile Test Co',
          zohoContactId: contactId,
        },
      });
      const zohoInvoiceId = `recon-invoice-${randomUUID()}`;
      const invoice = await owner.invoice.create({
        data: {
          brandId,
          customerId: customer.id,
          number: `RECON-${randomUUID().slice(0, 8)}`,
          status: 'SENT',
          invoiceDate: new Date('2026-08-01'),
          dueDate: new Date('2026-08-31'),
          currency: 'USD',
          totalMinor: 5000n,
          balanceMinor: 5000n,
          publicToken: randomUUID().replace(/-/g, ''),
          publicTokenActive: true,
          zohoInvoiceId,
          createdAt: opts.createdAt,
        },
      });
      return { invoice, zohoInvoiceId, customer, contactId };
    }

    function listItem(zohoInvoiceId: string, contactId: string): ZohoInvoiceListItem {
      return {
        invoice_id: zohoInvoiceId,
        customer_id: contactId,
        invoice_number: 'ZI-1',
        status: 'sent',
        date: '2026-08-01',
        due_date: '2026-08-31',
        currency_code: 'USD',
        total: 50,
        balance: 50,
      };
    }

    it('deactivates the payment link for an invoice Zoho no longer has', async () => {
      // Old enough to be past the creation grace window.
      const { invoice, contactId } = await zohoSourcedInvoice({
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const zoho = new FakeZohoBooksAdapter();
      // Zoho reports a different invoice, so ours is genuinely absent — but the
      // scan is non-empty, which is what makes absence meaningful.
      zoho.listedInvoices = [listItem(`someone-else-${randomUUID()}`, contactId)];

      await service(zoho).reconcileInvoicePresence(scope, brandId, connection);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.publicTokenActive).toBe(false);
      expect(after.zohoMissingSince).not.toBeNull();
      // Status deliberately untouched — deletion is inferred from silence, so it
      // must not rewrite the ledger.
      expect(after.status).toBe('SENT');
    });

    it('restores the payment link if the invoice turns up in Zoho again', async () => {
      const { invoice, zohoInvoiceId, contactId } = await zohoSourcedInvoice({
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      await owner.invoice.update({
        where: { id: invoice.id },
        data: { zohoMissingSince: new Date(), publicTokenActive: false },
      });

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [listItem(zohoInvoiceId, contactId)];

      await service(zoho).reconcileInvoicePresence(scope, brandId, connection);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.publicTokenActive).toBe(true);
      expect(after.zohoMissingSince).toBeNull();
    });

    it('spares a just-created invoice whose push may not have landed yet', async () => {
      // The race this guards: pushes run on the sync queue concurrently with
      // pulls, so a freshly issued invoice can exist locally and not yet in Zoho.
      const { invoice, contactId } = await zohoSourcedInvoice({ createdAt: new Date() });

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [listItem(`someone-else-${randomUUID()}`, contactId)];

      await service(zoho).reconcileInvoicePresence(scope, brandId, connection);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.publicTokenActive).toBe(true);
      expect(after.zohoMissingSince).toBeNull();
    });

    it('does nothing at all when Zoho reports no invoices', async () => {
      // An empty scan is equally consistent with a scan that failed to return
      // anything for a reason this code cannot see. Deactivating every payment
      // link a brand has on that basis would be far worse than waiting.
      const { invoice } = await zohoSourcedInvoice({
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [];

      await service(zoho).reconcileInvoicePresence(scope, brandId, connection);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.publicTokenActive).toBe(true);
      expect(after.zohoMissingSince).toBeNull();
    });

    it('archives a customer Zoho stops reporting, and restores it when it returns', async () => {
      const contactId = `gone-contact-${randomUUID()}`;
      const customer = await owner.customer.create({
        data: {
          brandId,
          type: 'BUSINESS',
          displayName: 'Vanishing Co',
          zohoContactId: contactId,
          status: 'ACTIVE',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      const svc = service(new FakeZohoBooksAdapter());

      // Zoho reports some other contact, so this one is genuinely absent.
      await svc.reconcileContactPresence(scope, brandId, [
        { contactId: `other-${randomUUID()}`, status: 'active' },
      ]);
      let after = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.status).toBe('ARCHIVED');

      // It comes back — reconciliation must reverse itself, since a contact
      // reported active again is not archived.
      await svc.reconcileContactPresence(scope, brandId, [{ contactId, status: 'active' }]);
      after = await owner.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.status).toBe('ACTIVE');
    });
  });

  /**
   * G-08. The refusal itself was always correct — Payment.invoiceId is
   * singular, so a Zoho payment spread across several invoices genuinely
   * cannot be represented. What was wrong was the reporting: recordPull marked
   * the job SUCCEEDED anyway, so the integrations panel showed a green
   * "Success" row for a payment that had in fact been dropped. An audit trail
   * that overstates what synced hides the limitation instead of surfacing it.
   */
  describe('skipped work is not reported as success', () => {
    it('records SKIPPED, not SUCCEEDED, for a payment spanning several invoices', async () => {
      const paymentId = `multi-invoice-payment-${randomUUID()}`;
      const zoho = new FakeZohoBooksAdapter();
      zoho.payments.set(paymentId, {
        payment_id: paymentId,
        date: '2026-08-05',
        payment_mode: 'banktransfer',
        amount: 100,
        customer_id: `some-contact-${randomUUID()}`,
        invoices: [
          { invoice_id: `inv-a-${randomUUID()}`, amount_applied: 60 },
          { invoice_id: `inv-b-${randomUUID()}`, amount_applied: 40 },
        ],
      });

      const applied = await service(zoho).pullOnePayment(scope, brandId, connection, paymentId);
      expect(applied).toBe(false);

      const job = await owner.syncJob.findFirst({
        where: { brandId, provider: 'ZOHO_BOOKS', direction: 'PULL', objectId: paymentId },
        orderBy: { createdAt: 'desc' },
      });
      expect(job?.status).toBe('SKIPPED');

      // And no Payment row was invented to make the numbers work.
      const payment = await owner.payment.findFirst({
        where: { brandId, zohoPaymentId: paymentId },
      });
      expect(payment).toBeNull();
    });

    it('still records SUCCEEDED when a pull genuinely applies a change', async () => {
      // Guards the other direction: the predicate must not turn every pull into
      // a skip. A list wrapper returning 0 for "nothing had changed" is a real
      // success, not a refusal, which is why the check is an explicit predicate
      // rather than any falsy result.
      const contactId = `applied-contact-${randomUUID()}`;
      const zoho = new FakeZohoBooksAdapter();
      zoho.contacts.set(contactId, fakeContact(contactId, 'Applied Co'));

      expect(await service(zoho).pullOneCustomer(scope, brandId, connection, contactId)).toBe(true);

      const job = await owner.syncJob.findFirst({
        where: { brandId, provider: 'ZOHO_BOOKS', direction: 'PULL', objectId: contactId },
        orderBy: { createdAt: 'desc' },
      });
      expect(job?.status).toBe('SUCCEEDED');
    });
  });

  /**
   * Resilience of a phase to one unusable record.
   *
   * mapWithConcurrency propagates the first rejection, so before
   * pullRecordTolerantly a single bad record failed its phase, which failed
   * pullBrand's Promise.all, which meant recordPullRun never ran and the
   * brand's cursor never advanced — every subsequent pull then re-fetched the
   * same window and failed identically. The brand stopped syncing entirely
   * because of one row. The currency and invoice-number validations made that
   * easy to trigger.
   */
  describe('one unusable record does not stall the phase', () => {
    it('pulls the good invoices and skips one in an unsupported currency', async () => {
      const contactId = `tolerant-contact-${randomUUID()}`;
      const goodId = `tolerant-good-${randomUUID()}`;
      const badId = `tolerant-bad-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.contacts.set(contactId, fakeContact(contactId, 'Tolerant Co'));
      zoho.listedInvoices = [
        { ...fakeInvoice(goodId, `TG-${randomUUID().slice(0, 8)}`, contactId) },
        { ...fakeInvoice(badId, `TB-${randomUUID().slice(0, 8)}`, contactId) },
      ] as never[];
      zoho.invoices.set(goodId, fakeInvoice(goodId, `TG-${randomUUID().slice(0, 8)}`, contactId));
      zoho.invoices.set(badId, {
        // JPY is genuinely unrepresentable here — every amount would be 100x
        // wrong — so this invoice must be refused. The other one must not be.
        ...fakeInvoice(badId, `TB-${randomUUID().slice(0, 8)}`, contactId),
        currency_code: 'JPY',
      });

      // Resolves rather than rejecting: that is the whole point.
      const touched = await service(zoho).pullInvoices(scope, brandId, connection, null);
      expect(touched).toBe(1);

      const good = await owner.invoice.findFirst({ where: { brandId, zohoInvoiceId: goodId } });
      expect(good).not.toBeNull();
      const bad = await owner.invoice.findFirst({ where: { brandId, zohoInvoiceId: badId } });
      expect(bad).toBeNull();

      // The refusal is not silent — it is a FAILED row naming the currency.
      const job = await owner.syncJob.findFirst({
        where: { brandId, direction: 'PULL', objectId: badId },
        orderBy: { createdAt: 'desc' },
      });
      expect(job?.status).toBe('FAILED');
      expect(job?.errorClass).toBe('VALIDATION');
      expect(job?.lastError ?? '').toContain('JPY');
    });

    it('still aborts the phase on a systemic failure', async () => {
      // The other half of the rule. An expired credential or a rate limit will
      // fail every remaining record too, so grinding through hundreds more would
      // hammer a rejected token or burn the rate limit for nothing.
      const contactId = `systemic-contact-${randomUUID()}`;
      const invoiceId = `systemic-invoice-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [
        { ...fakeInvoice(invoiceId, `SY-${randomUUID().slice(0, 8)}`, contactId) },
      ] as never[];
      zoho.getInvoiceImpl = () => {
        throw new IntegrationError({
          message: 'invalid oauth token',
          errorClass: 'AUTHENTICATION',
          provider: 'zoho-books',
        });
      };

      await expect(service(zoho).pullInvoices(scope, brandId, connection, null)).rejects.toThrow(
        /invalid oauth token/,
      );
    });
  });
});
