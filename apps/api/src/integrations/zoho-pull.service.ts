import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IntegrationError,
  type AccountingConnection,
  type InvoiceStatus,
  type Scope,
} from '@fenwick/shared';
import { mapWithConcurrency } from '../common/concurrency.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { SystemScopeResolver } from '../tenancy/system-scope.js';
import {
  ZohoBooksAdapter,
  type ZohoInvoiceDetail,
} from '../adapters/accounting/zoho-books.adapter.js';
import { IntegrationConnectionService } from './integration-connection.service.js';

export interface PullCounts {
  readonly customers: number;
  readonly invoices: number;
  readonly payments: number;
}

/**
 * How many of a page's detail fetches (getContact/getInvoice/getPayment) run
 * at once. This is about overlapping round-trip latency, not the real
 * throughput ceiling — ZohoBooksAdapter.request's own per-brand rate limiter
 * is what actually paces requests against Zoho's 100-req/min budget, so
 * raising this only helps up to the point that limiter has enough concurrent
 * callers to keep it saturated; it can't push traffic past what the limiter
 * allows.
 */
const PULL_DETAIL_CONCURRENCY = 8;

/**
 * Contacts have no server-side filter at all (see ZohoBooksAdapter's "Pull"
 * notes), so pullCustomers always pages through every contact the brand has,
 * regardless of whether any of them changed. Run on a brand set to
 * "Realtime" (pullFrequencyMinutes: 1), that full scan would otherwise
 * repeat every single minute for data that is realistically not moving that
 * fast — customer records change far less often than invoice/payment status
 * does, which is what "Realtime" is actually meant to keep fresh. This is a
 * floor under just that one scan, independent of the brand's own configured
 * frequency: at most one full contact scan per window, tracked in Redis
 * rather than a new column since it is a pacing decision, not sync state
 * anything else needs to read. A manual "pull now" (pullBrand's
 * forceFullContactScan) bypasses it — someone who just fixed a customer's
 * details in Zoho and asked for a pull right now should get one.
 */
const CONTACTS_FULL_SCAN_FLOOR_SECONDS = 15 * 60;

/** Zoho's invoice status vocabulary onto ours. Zoho has no direct
 * counterpart to our overdue tracking (a separate boolean flag here, not a
 * status value) — "overdue" reads as PENDING_PAYMENT, same as "unpaid". */
const INVOICE_STATUS_MAP: Record<string, InvoiceStatus> = {
  draft: 'DRAFT',
  sent: 'SENT',
  viewed: 'VIEWED',
  unpaid: 'PENDING_PAYMENT',
  overdue: 'PENDING_PAYMENT',
  partially_paid: 'PARTIALLY_PAID',
  paid: 'PAID',
  void: 'CANCELLED',
};

/**
 * FR-ZHO-030: the reverse of ZohoSyncService — brings a brand's existing
 * Zoho Books data (contacts, invoices, customer payments) into the local
 * database, and keeps pulling on a schedule (worker.ts registers this
 * against the 'scheduled-sync' cron already defined in queues.ts).
 *
 * Zoho is treated as authoritative for everything pulled: totals, balance
 * and status come from Zoho's own numbers directly, not recomputed via
 * calculate() — recomputing would risk disagreeing with whatever tax/fee
 * logic actually produced the real invoice in the user's Zoho account.
 *
 * See ZohoBooksAdapter's "Pull" section for exactly what each entity type's
 * incremental-fetch capability actually is per the real API — they are not
 * symmetric, and this service's per-entity strategy follows directly from
 * that (documented there, not repeated here).
 */
@Injectable()
export class ZohoPullService {
  private readonly logger = new Logger(ZohoPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoBooksAdapter,
    private readonly connections: IntegrationConnectionService,
    private readonly systemScope: SystemScopeResolver,
    private readonly redis: RedisService,
  ) {}

  /**
   * @param forceFullContactScan Bypasses CONTACTS_FULL_SCAN_FLOOR_SECONDS —
   * set by the on-demand "pull now" endpoint, never by the scheduled tick.
   */
  async pullBrand(brandId: string, forceFullContactScan = false): Promise<PullCounts> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-pull');
    if (!scope) return { customers: 0, invoices: 0, payments: 0 };
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return { customers: 0, invoices: 0, payments: 0 };

    const pullStartedAt = new Date();
    const cursor = await this.connections.getLastPulledAt(scope, brandId);

    // The three entity types don't depend on each other's *completion*
    // anymore — pullOneInvoice/pullOnePayment's cascades into a not-yet-seen
    // customer or invoice are upsert-safe now (brandId_zohoContactId /
    // brandId_zohoInvoiceId), the same property that already made
    // mapWithConcurrency safe within a single phase. Running the three
    // phases concurrently instead of sequentially overlaps their network
    // waiting time; ZohoBooksAdapter.request's shared per-brand rate limiter
    // is still what caps how much of that time turns into actual Zoho
    // traffic, so this is free concurrency, not more load. The one cost is
    // a little redundant work at the boundary — e.g. pullInvoices pulling an
    // invoice explicitly at the same moment pullPayments' cascade pulls it
    // too because a payment referenced it — which is strictly rarer than the
    // wall-clock time this removes (that overlap window only exists among
    // records that changed since the very last pull).
    const [customers, invoices, payments] = await Promise.all([
      this.pullCustomersIfDue(scope, brandId, connection, cursor, forceFullContactScan),
      this.pullInvoices(scope, brandId, connection, cursor),
      this.pullPayments(scope, brandId, connection),
    ]);

    await this.connections.recordPullRun(scope, brandId, pullStartedAt);

    const counts = { customers, invoices, payments };
    this.logger.log(
      `pull complete for brand ${brandId}: ${counts.customers} customers, ${counts.invoices} invoices, ${counts.payments} payments`,
    );
    return counts;
  }

  private async pullCustomersIfDue(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    cursor: Date | null,
    force: boolean,
  ): Promise<number> {
    const floorKey = `zoho:contacts-scanned:${brandId}`;
    if (!force && (await this.redis.getJson<boolean>(floorKey))) {
      return 0;
    }
    const touched = await this.pullCustomers(scope, brandId, connection, cursor);
    // Set after a successful scan regardless of `force`, so a manual pull
    // now restarts the floor's own clock too, rather than leaving the next
    // scheduled tick free to redundantly re-scan moments later.
    await this.redis.setJson(floorKey, true, CONTACTS_FULL_SCAN_FLOOR_SECONDS);
    return touched;
  }

  // --- Customers -------------------------------------------------------------

  /**
   * The paginated scan itself (as opposed to each pullOneCustomer call below)
   * was not previously recorded anywhere — a rate limit or auth failure on
   * the very first listContactsPage call propagated straight out of
   * pullBrand with zero SyncJob rows created, which meant a total,
   * brand-level failure showed as nothing at all in "Recent activity". This
   * wrapper exists specifically so that failure is visible too, not just
   * per-record ones.
   */
  private async pullCustomers(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    cursor: Date | null,
  ): Promise<number> {
    return this.recordPull(brandId, 'CUSTOMER', 'list', async () => {
      let page = 1;
      let hasMore = true;
      let touched = 0;

      while (hasMore) {
        const { contacts, hasMorePage } = await this.zoho.listContactsPage(connection, page);
        const due = contacts.filter(
          (item) =>
            !cursor || !item.last_modified_time || new Date(item.last_modified_time) > cursor,
        );
        await mapWithConcurrency(due, PULL_DETAIL_CONCURRENCY, (item) =>
          this.pullOneCustomer(scope, brandId, connection, item.contact_id),
        );
        touched += due.length;
        hasMore = hasMorePage;
        page++;
      }
      return touched;
    });
  }

  /** Also used as the cascade target when an invoice or payment references a
   * Zoho contact_id we have not seen locally yet. */
  private async pullOneCustomer(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    contactId: string,
  ): Promise<void> {
    await this.recordPull(brandId, 'CUSTOMER', contactId, async () => {
      const contact = await this.zoho.getContact(connection, contactId);
      const data = {
        type: (contact.customer_sub_type === 'individual' ? 'INDIVIDUAL' : 'BUSINESS') as
          'INDIVIDUAL' | 'BUSINESS',
        displayName: contact.contact_name,
        companyName: contact.company_name ?? null,
        firstName: contact.first_name ?? null,
        lastName: contact.last_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        billingAddress: (this.zoho.fromZohoAddress(contact.billing_address) ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
        shippingAddress: (this.zoho.fromZohoAddress(contact.shipping_address) ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
      };

      // A single upsert, not a separate findFirst-then-create/update: two
      // concurrent calls for the same not-yet-seen contact_id (the cascades
      // below, or two pages' worth of the same due-list) resolve cleanly
      // here — proven against a real concurrent race, not assumed — because
      // Postgres compiles this to a genuine INSERT ... ON CONFLICT
      // (brand_id, zoho_contact_id) DO UPDATE, which is atomic: one caller's
      // INSERT wins, the other's own attempt transparently becomes the
      // UPDATE branch, with neither seeing an error. (The line-item replace
      // in pullOneInvoice below needed more than this — see its own comment
      // — but that turned out to be a real race in a *different* place, not
      // evidence that upsert itself needed the same treatment.)
      await this.prisma.withScope(scope, (tx) =>
        tx.customer.upsert({
          where: { brandId_zohoContactId: { brandId, zohoContactId: contactId } },
          create: { ...data, brandId, zohoContactId: contactId },
          update: data,
        }),
      );
    });
  }

  private async localCustomerId(
    scope: Scope,
    brandId: string,
    contactId: string,
  ): Promise<string | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.customer.findFirst({ where: { brandId, zohoContactId: contactId }, select: { id: true } }),
    );
    return row?.id ?? null;
  }

  // --- Invoices ----------------------------------------------------------------

  private async pullInvoices(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    cursor: Date | null,
  ): Promise<number> {
    return this.recordPull(brandId, 'INVOICE', 'list', async () => {
      let page = 1;
      let hasMore = true;
      let touched = 0;
      const sinceIso = cursor ? cursor.toISOString() : null;

      while (hasMore) {
        const { invoices, hasMorePage } = await this.zoho.listInvoicesPage(
          connection,
          page,
          sinceIso,
        );
        await mapWithConcurrency(invoices, PULL_DETAIL_CONCURRENCY, (item) =>
          this.pullOneInvoice(scope, brandId, connection, item.invoice_id),
        );
        touched += invoices.length;
        hasMore = hasMorePage;
        page++;
      }
      return touched;
    });
  }

  private async pullOneInvoice(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    invoiceId: string,
  ): Promise<void> {
    await this.recordPull(brandId, 'INVOICE', invoiceId, async () => {
      const invoice = await this.zoho.getInvoice(connection, invoiceId);

      let customerId = await this.localCustomerId(scope, brandId, invoice.customer_id);
      if (!customerId) {
        await this.pullOneCustomer(scope, brandId, connection, invoice.customer_id);
        customerId = await this.localCustomerId(scope, brandId, invoice.customer_id);
      }
      if (!customerId) {
        throw new IntegrationError({
          message: `invoice ${invoiceId} references Zoho contact ${invoice.customer_id}, which could not be pulled`,
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      }

      const taxRateBpApplied =
        invoice.sub_total > 0 ? Math.round((invoice.tax_total / invoice.sub_total) * 10000) : 0;

      const data = {
        customerId,
        number: invoice.invoice_number,
        status: INVOICE_STATUS_MAP[invoice.status] ?? 'SENT',
        invoiceDate: new Date(invoice.date),
        dueDate: new Date(invoice.due_date),
        currency: invoice.currency_code,
        subtotalMinor: BigInt(this.zoho.decimalToMinor(invoice.sub_total)),
        taxRateBpApplied,
        taxMinor: BigInt(this.zoho.decimalToMinor(invoice.tax_total)),
        totalMinor: BigInt(this.zoho.decimalToMinor(invoice.total)),
        balanceMinor: BigInt(this.zoho.decimalToMinor(invoice.balance)),
        notes: invoice.notes ?? null,
      };

      // Upserting on brandId_zohoInvoiceId — the same idea as pullOneCustomer's,
      // and usually enough on its own the same way: Postgres compiles it to a
      // real INSERT ... ON CONFLICT (brand_id, zoho_invoice_id) DO UPDATE,
      // atomic against two concurrent calls for the same not-yet-seen
      // invoice_id (pullOnePayment's cascade can have two partial payments
      // both trigger this at once).
      //
      // "Usually" — the one case that ON CONFLICT does NOT absorb is this
      // invoice also colliding on a *different* unique constraint,
      // (brand_id, number): both concurrent calls fetched the same Zoho
      // invoice, so they propose the identical invoice_number too. Postgres
      // only arbitrates the constraint actually named in ON CONFLICT; a
      // second, incidental collision on `number` is checked with ordinary
      // (non-speculative) insertion semantics, and — confirmed against the
      // real database, not assumed — can raise a genuine unique-violation
      // error on *either or both* concurrent callers even though the row
      // they're each trying to write is, semantically, the exact same
      // invoice. withUniqueViolationRetry exists for exactly this: a retried
      // call re-resolves brandId_zohoInvoiceId against the now-committed
      // winner and takes the UPDATE branch, which touches no other unique
      // index at all.
      //
      // What is NOT safe to do concurrently, independent of the above, is
      // the naive way to "replace" line items — deleteMany then createMany
      // in the same transaction. Two concurrent pulls of the same invoice
      // can interleave: B's deleteMany finds nothing (A's insert hasn't
      // reached its own createMany yet), then both createMany collide on
      // (invoice_id, position) — also confirmed, not assumed. Upserting each
      // line item individually makes each one individually race-safe the
      // same way the invoice row is; only the trim for a shrunk item count
      // needs a plain delete, scoped past the new range so it can't touch a
      // row a concurrent call is still writing.
      await this.withUniqueViolationRetry(() =>
        this.prisma.withScope(scope, async (tx) => {
          const row = await tx.invoice.upsert({
            where: { brandId_zohoInvoiceId: { brandId, zohoInvoiceId: invoiceId } },
            create: {
              ...data,
              brandId,
              zohoInvoiceId: invoiceId,
              publicToken: this.randomPublicToken(),
              cardFeeRateBpApplied: 0,
              cardFeeMinor: 0n,
            },
            update: data,
          });

          const lineItems = this.toLocalLineItems(row.id, invoice);
          for (const item of lineItems) {
            await tx.lineItem.upsert({
              where: { invoiceId_position: { invoiceId: row.id, position: item.position } },
              create: item,
              update: item,
            });
          }
          await tx.lineItem.deleteMany({
            where: { invoiceId: row.id, position: { gte: lineItems.length } },
          });
        }),
      );
    });
  }

  /**
   * Retries `work` on a unique-constraint violation — see the long comment
   * at pullOneInvoice's own upsert for exactly which real race this exists
   * for. Verified against the actual database under real concurrency (a
   * 20-trial harness, not a single lucky run) before landing this: retrying
   * the *whole* upsert resolves every time, because by the time one caller's
   * attempt has failed, the other's has already committed — the retry's own
   * attempt finds that row via the real conflict target and takes the
   * UPDATE branch, which cannot collide on anything else. A short jittered
   * delay between attempts, not a tight loop, since this is arbitrating
   * against a concurrent transaction that needs a moment to actually commit.
   */
  private async withUniqueViolationRetry<T>(
    work: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (attempt === attempts || !PrismaService.isUniqueViolation(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
      }
    }
    // Unreachable — the loop above always either returns or throws — but
    // TypeScript can't see that a for-loop with no fallthrough always exits.
    throw new Error('withUniqueViolationRetry: exhausted attempts without a result');
  }

  private toLocalLineItems(
    invoiceId: string,
    invoice: ZohoInvoiceDetail,
  ): Array<{
    invoiceId: string;
    position: number;
    itemName: string;
    description: string | null;
    quantity: number;
    unitPriceMinor: bigint;
    lineTotalMinor: bigint;
    taxExempt: boolean;
  }> {
    return invoice.line_items.map((line, position) => ({
      invoiceId,
      position,
      itemName: line.name ?? `Line ${position + 1}`,
      description: line.description ?? null,
      // Our Quantity type is fixed-point scaled by 10,000 (packages/shared
      // money/quantity.ts) — Zoho's quantity is a plain decimal.
      quantity: Math.round(line.quantity * 10_000),
      unitPriceMinor: BigInt(this.zoho.decimalToMinor(line.rate)),
      lineTotalMinor: BigInt(this.zoho.decimalToMinor(line.rate * line.quantity)),
      taxExempt: !line.tax_id,
    }));
  }

  private randomPublicToken(): string {
    // Must match InvoicesService.create exactly, and for the same reason: this
    // token is the ONLY credential protecting the public payment page
    // (NFR-SEC-014), and invoice numbers are sequential and guessable. A
    // Math.random() version of this stood here previously — that is a
    // non-cryptographic PRNG whose internal state is recoverable from a few
    // observed outputs, so holding one legitimate payment link would have let
    // an attacker predict the tokens of every other invoice pulled alongside
    // it.
    return randomBytes(16).toString('hex');
  }

  // --- Customer payments ---------------------------------------------------

  private async pullPayments(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
  ): Promise<number> {
    return this.recordPull(brandId, 'PAYMENT', 'list', async () => {
      let page = 1;
      let hasMore = true;
      let touched = 0;

      while (hasMore) {
        const { payments, hasMorePage } = await this.zoho.listPaymentsPage(connection, page);

        // Unlike pullCustomers' changedSinceCursor check, this isn't "did it
        // change" — Zoho exposes no modified-time field on payments at all
        // (see the adapter's "Pull" notes), so there is no cheaper signal
        // than the detail fetch itself to tell. What's checked instead is
        // "have we already pulled this one, ever" — a settled payment is
        // not something Zoho expects to change after the fact, so already
        // having a local row is enough to skip it for good. Without this,
        // every payment on the account gets a fresh getPayment call on every
        // single pull, forever, regardless of age (payment_zoho_payment_id_
        // idx is what keeps this check itself cheap — plain Promise.all,
        // not mapWithConcurrency, since these are local Postgres reads, not
        // calls against Zoho's own rate limit).
        const alreadyPulled = await Promise.all(
          payments.map((item) => this.paymentAlreadyPulled(scope, brandId, item.payment_id)),
        );
        const due = payments.filter((_, index) => !alreadyPulled[index]);

        const applied = await mapWithConcurrency(due, PULL_DETAIL_CONCURRENCY, (item) =>
          this.pullOnePayment(scope, brandId, connection, item.payment_id),
        );
        touched += applied.filter(Boolean).length;

        hasMore = hasMorePage;
        page++;
      }
      return touched;
    });
  }

  private async paymentAlreadyPulled(
    scope: Scope,
    brandId: string,
    paymentId: string,
  ): Promise<boolean> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.payment.findFirst({
        where: { brandId, zohoPaymentId: paymentId },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  /** Returns false for a payment this cannot represent (0 or 2+ invoices —
   * our Payment.invoiceId is singular) rather than dropping or mis-mapping
   * it silently. */
  private async pullOnePayment(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    paymentId: string,
  ): Promise<boolean> {
    return this.recordPull(brandId, 'PAYMENT', paymentId, async () => {
      const payment = await this.zoho.getPayment(connection, paymentId);

      if (!payment.invoices || payment.invoices.length !== 1) {
        this.logger.warn(
          `skipping Zoho payment ${paymentId} — applies to ${payment.invoices?.length ?? 0} invoices, ` +
            'and this schema only supports one invoice per payment',
        );
        return false;
      }
      const zohoInvoiceId = payment.invoices[0]!.invoice_id;

      let invoiceRow = await this.prisma.withScope(scope, (tx) =>
        tx.invoice.findFirst({ where: { brandId, zohoInvoiceId }, select: { id: true } }),
      );
      if (!invoiceRow) {
        await this.pullOneInvoice(scope, brandId, connection, zohoInvoiceId);
        invoiceRow = await this.prisma.withScope(scope, (tx) =>
          tx.invoice.findFirst({ where: { brandId, zohoInvoiceId }, select: { id: true } }),
        );
      }
      if (!invoiceRow) {
        throw new IntegrationError({
          message: `payment ${paymentId} references Zoho invoice ${zohoInvoiceId}, which could not be pulled`,
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      }

      // Currency follows the invoice this payment settles, never a hardcoded
      // default — a brand billing in CAD or GBP would otherwise have every
      // pulled payment recorded as USD against a non-USD invoice.
      const invoiceCurrency = await this.prisma.withScope(scope, (tx) =>
        tx.invoice.findUnique({ where: { id: invoiceRow.id }, select: { currency: true } }),
      );

      const data = {
        method: this.zoho.reverseMapPaymentMode(payment.payment_mode),
        amountMinor: BigInt(this.zoho.decimalToMinor(payment.amount)),
        currency: invoiceCurrency?.currency ?? 'USD',
        status: 'SETTLED' as const,
        settledAt: new Date(payment.date),
      };

      await this.prisma.withScope(scope, async (tx) => {
        const existing = await tx.payment.findFirst({
          where: { brandId, zohoPaymentId: paymentId },
        });
        if (existing) {
          await tx.payment.update({ where: { id: existing.id }, data });
        } else {
          await tx.payment.create({
            data: {
              ...data,
              brandId,
              invoiceId: invoiceRow!.id,
              zohoPaymentId: paymentId,
              // No natural idempotency input for a pulled record (that key
              // exists to dedupe our own createIntent retries) — synthesized
              // from the Zoho payment id itself, unique and stable, and
              // distinguishable from our sha256-hex keys by format alone.
              idempotencyKey: `zoho:${paymentId}`,
            },
          });
        }
      });
      return true;
    });
  }

  // --- SyncJob recording -----------------------------------------------------

  /** Mirrors ZohoSyncService.runJob but for direction: PULL — kept as its
   * own small copy rather than shared, so a change to the push path's
   * retry/recording behaviour cannot silently alter the pull path's. */
  private async recordPull<T>(
    brandId: string,
    objectType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT',
    objectId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const job = await this.prisma.withoutScope(
      `recording pull job start for brand ${brandId}`,
      (client) =>
        client.syncJob.create({
          data: {
            brandId,
            provider: 'ZOHO_BOOKS',
            direction: 'PULL',
            objectType,
            objectId,
            status: 'RUNNING',
          },
        }),
    );

    try {
      const result = await work();
      await this.prisma.withoutScope(`recording pull job success for brand ${brandId}`, (client) =>
        client.syncJob.update({
          where: { id: job.id },
          data: { status: 'SUCCEEDED', completedAt: new Date() },
        }),
      );
      return result;
    } catch (error) {
      const integrationError = error instanceof IntegrationError ? error : null;
      await this.prisma.withoutScope(`recording pull job failure for brand ${brandId}`, (client) =>
        client.syncJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorClass: integrationError?.errorClass ?? 'PERMANENT',
            lastError:
              integrationError?.providerMessage ??
              (error instanceof Error ? error.message : String(error)),
          },
        }),
      );
      this.logger.warn(
        `Zoho pull failed — brand ${brandId}, ${objectType} ${objectId}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}
