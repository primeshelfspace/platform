/**
 * ZohoPullService against a real database.
 *
 * Invoices are pulled list-only (no per-invoice detail fetch), so
 * pullOneInvoice takes the list item directly rather than an id it would
 * otherwise have to re-fetch. The race this still has to resolve correctly:
 * running a page's per-item work concurrently means two of pullOneInvoice's
 * own cascade calls can land on the same not-yet-seen remote customer in the
 * same batch — two invoices for one new customer, both referencing it. The
 * brandId_zohoContactId / brandId_zohoInvoiceId uniqueness plus the upsert
 * these methods use is what has to actually resolve that race, not just look
 * like it does.
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
  type ZohoInvoiceListItem,
} from '../adapters/accounting/zoho-books.adapter.js';
import type { IntegrationConnectionService } from './integration-connection.service.js';
import type { SystemScopeResolver } from '../tenancy/system-scope.js';
import { ZohoPullService } from './zoho-pull.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

/**
 * Programmable stand-in for the network calls only. fromZohoAddress and
 * decimalToMinor are the real, pure implementations (inherited, unmodified)
 * — the same ones zoho-books.adapter.test.ts checks directly — so only the
 * methods that actually reach the network here are overridden.
 */
class FakeZohoBooksAdapter extends ZohoBooksAdapter {
  getContactCalls = 0;

  readonly contacts = new Map<string, ZohoContactDetail>();
  listedContacts: ZohoContactListItem[] = [];
  /** Drives both pullInvoices and reconcileInvoicePresence's full scan. Empty
   * by default, which is what every pre-existing test already assumed. */
  listedInvoices: ZohoInvoiceListItem[] = [];

  constructor() {
    super({} as Env, {} as RedisService);
  }

  override async listContactsPage() {
    return { contacts: this.listedContacts, hasMorePage: false };
  }

  /** Lets a test make the customer cascade's detail fetch itself fail, to
   * exercise how a phase reacts to a systemic error rather than a bad
   * record — the invoice side has no detail fetch of its own to fail
   * anymore, so this is the one real network call left in the cascade an
   * invoice pull can still trigger. */
  getContactImpl: ((contactId: string) => ZohoContactDetail) | undefined;

  override async getContact(_connection: AccountingConnection, contactId: string) {
    this.getContactCalls++;
    if (this.getContactImpl) return this.getContactImpl(contactId);
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error(`no fake contact stubbed for ${contactId}`);
    return contact;
  }

  override async listInvoicesPage() {
    return { invoices: this.listedInvoices, hasMorePage: false };
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

/** The list-response shape ZohoPullService's invoice pull now works from
 * exclusively — no sub_total/tax_total/line_items, since those are only on
 * the single-record GET this platform no longer calls. */
function fakeInvoiceListItem(
  invoiceId: string,
  number: string,
  customerId: string,
): ZohoInvoiceListItem {
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
        item: ZohoInvoiceListItem,
      ) => Promise<boolean>;
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
    const itemA = fakeInvoiceListItem(invoiceIdA, `INV-A-${randomUUID().slice(0, 8)}`, contactId);
    const itemB = fakeInvoiceListItem(invoiceIdB, `INV-B-${randomUUID().slice(0, 8)}`, contactId);

    const svc = service(zoho);
    await Promise.all([
      svc.pullOneInvoice(scope, brandId, connection, itemA),
      svc.pullOneInvoice(scope, brandId, connection, itemB),
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
   * Echo suppression (Invoice.zohoSyncedVersion / Customer.zohoSyncedVersion).
   * pushInvoice sends tax and the card fee to Zoho as ordinary line items,
   * and pushInvoice/upsertCustomer both send a narrower payload than what
   * comes back on a pull — so reading our own write back as if it were a
   * remote edit is a real hazard, not a hypothetical one. The invoice side is
   * narrower than it used to be now that the pull is list-only (no more
   * subtotal/tax/line-item corruption to guard, since those fields are no
   * longer written on an update at all) — what's left to protect is
   * total/balance/status not getting reverted to a stale push-time snapshot.
   */
  describe('push/pull echo suppression', () => {
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
      return { customer, invoice, contactId };
    }

    it('leaves an invoice untouched when Zoho reports nothing newer than our own push', async () => {
      const zohoInvoiceId = `echo-invoice-${randomUUID()}`;
      const pushedAt = new Date('2026-08-20T10:00:00.000Z');
      const { invoice, contactId } = await localInvoicePushedToZoho(zohoInvoiceId, pushedAt);

      const zoho = new FakeZohoBooksAdapter();
      const item: ZohoInvoiceListItem = {
        invoice_id: zohoInvoiceId,
        customer_id: contactId,
        invoice_number: invoice.number,
        status: 'sent',
        date: '2026-08-01',
        due_date: '2026-08-31',
        currency_code: 'USD',
        total: 111,
        balance: 111,
        // Exactly equal to the stored version — an unchanged record reports
        // the timestamp of our own write, which is why the check is <= and
        // not <.
        last_modified_time: pushedAt.toISOString(),
      };

      const applied = await service(zoho).pullOneInvoice(scope, brandId, connection, item);
      expect(applied).toBe(false);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      // Untouched by the skipped update — still whatever was there before,
      // not overwritten with the list item's (echoed) total/balance/status.
      expect(after.subtotalMinor).toBe(10000n);
      expect(after.taxMinor).toBe(800n);
      expect(after.cardFeeMinor).toBe(300n);
      expect(after.totalMinor).toBe(11100n);
      expect(after.status).toBe('SENT');
    });

    it('still applies a genuine Zoho edit made after our push', async () => {
      const zohoInvoiceId = `real-edit-invoice-${randomUUID()}`;
      const pushedAt = new Date('2026-08-20T10:00:00.000Z');
      const { invoice, contactId } = await localInvoicePushedToZoho(zohoInvoiceId, pushedAt);

      const zoho = new FakeZohoBooksAdapter();
      const item: ZohoInvoiceListItem = {
        invoice_id: zohoInvoiceId,
        customer_id: contactId,
        invoice_number: invoice.number,
        status: 'paid',
        date: '2026-08-01',
        due_date: '2026-08-31',
        currency_code: 'USD',
        total: 250,
        balance: 0,
        // An hour later: somebody actually changed this in Zoho, so Zoho is
        // authoritative and the pull must overwrite.
        last_modified_time: new Date(pushedAt.getTime() + 3_600_000).toISOString(),
      };

      const applied = await service(zoho).pullOneInvoice(scope, brandId, connection, item);
      expect(applied).toBe(true);

      const after = await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.totalMinor).toBe(25000n);
      expect(after.balanceMinor).toBe(0n);
      expect(after.status).toBe('PAID');
      // subtotalMinor/taxMinor/cardFeeMinor are not part of the list-only
      // update data at all — a genuine remote edit does not touch them
      // either, only total/balance/status/dates/customer/number do.
      expect(after.subtotalMinor).toBe(10000n);
      expect(after.taxMinor).toBe(800n);
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

  describe('skipped work is not reported as success', () => {
    it('still records SUCCEEDED when a pull genuinely applies a change', async () => {
      // The predicate must not turn every pull into a skip. A list wrapper
      // returning 0 for "nothing had changed" is a real success, not a
      // refusal, which is why the check is an explicit predicate rather than
      // any falsy result.
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
   * A single bad record must not fail its whole phase — that would fail
   * pullBrand's Promise.all, which would mean recordPullRun never runs and the
   * brand's cursor never advances. The brand would stop syncing entirely
   * because of one row, and every subsequent pull would re-fetch the same
   * window and fail identically. The currency validation made that easy to
   * trigger.
   */
  describe('one unusable record does not stall the phase', () => {
    it('pulls the good invoices and skips one in an unsupported currency', async () => {
      const contactId = `tolerant-contact-${randomUUID()}`;
      const goodId = `tolerant-good-${randomUUID()}`;
      const badId = `tolerant-bad-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.contacts.set(contactId, fakeContact(contactId, 'Tolerant Co'));
      zoho.listedInvoices = [
        fakeInvoiceListItem(goodId, `TG-${randomUUID().slice(0, 8)}`, contactId),
        {
          // JPY is genuinely unrepresentable here — every amount would be
          // 100x wrong — so this invoice must be refused. The other one must
          // not be.
          ...fakeInvoiceListItem(badId, `TB-${randomUUID().slice(0, 8)}`, contactId),
          currency_code: 'JPY',
        },
      ];

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
      // hammer a rejected token or burn the rate limit for nothing. Invoices no
      // longer have their own detail fetch to fail, so this drives the failure
      // through the one real network call an invoice pull can still trigger:
      // the not-yet-seen customer cascade's getContact.
      const contactId = `systemic-contact-${randomUUID()}`;
      const invoiceId = `systemic-invoice-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [
        fakeInvoiceListItem(invoiceId, `SY-${randomUUID().slice(0, 8)}`, contactId),
      ];
      zoho.getContactImpl = () => {
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

  /**
   * The dangerous half of failure tolerance.
   *
   * pullRecordTolerantly swallows record-specific failures so one bad row cannot
   * stall a brand. The hazard is over-applying that: an infrastructure failure
   * is not a bad row, and swallowing it lets the phase report success and the
   * cursor advance past a window that was never pulled — those records are then
   * never fetched again. Silent data loss, and strictly worse than failing and
   * retrying. Tolerance therefore requires a positively identified
   * record-specific IntegrationError; anything unrecognised propagates.
   */
  describe('unknown failures are never mistaken for bad records', () => {
    it('propagates an infrastructure error instead of skipping the record', async () => {
      const contactId = `infra-contact-${randomUUID()}`;
      const invoiceId = `infra-invoice-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [
        fakeInvoiceListItem(invoiceId, `IF-${randomUUID().slice(0, 8)}`, contactId),
      ];
      // Not an IntegrationError — the shape a Prisma/Redis outage or a
      // programming error actually takes.
      zoho.getContactImpl = () => {
        throw new TypeError("Cannot read properties of undefined (reading 'connect')");
      };

      await expect(service(zoho).pullInvoices(scope, brandId, connection, null)).rejects.toThrow(
        TypeError,
      );
    });

    it('still tolerates a record-specific IntegrationError', async () => {
      // The other side of the same rule, so the fix above cannot be "propagate
      // everything", which would reintroduce the brand-wide stall.
      const contactId = `spec-contact-${randomUUID()}`;
      const invoiceId = `spec-invoice-${randomUUID()}`;

      const zoho = new FakeZohoBooksAdapter();
      zoho.listedInvoices = [
        fakeInvoiceListItem(invoiceId, `SP-${randomUUID().slice(0, 8)}`, contactId),
      ];
      zoho.getContactImpl = () => {
        throw new IntegrationError({
          message: 'this particular contact is malformed',
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      };

      await expect(service(zoho).pullInvoices(scope, brandId, connection, null)).resolves.toBe(0);
    });
  });
});
