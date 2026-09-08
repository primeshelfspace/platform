import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IntegrationError,
  isSupportedCurrency,
  type AccountingConnection,
  type CurrencyCode,
  type InvoiceStatus,
  type Scope,
} from '@fenwick/shared';
import { mapWithConcurrency } from '../common/concurrency.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { SystemScopeResolver } from '../tenancy/system-scope.js';
import {
  ZohoBooksAdapter,
  type ZohoInvoiceListItem,
} from '../adapters/accounting/zoho-books.adapter.js';
import { IntegrationConnectionService } from './integration-connection.service.js';

export interface PullCounts {
  readonly customers: number;
  readonly invoices: number;
}

/**
 * How many of a page's per-contact getContact detail fetches run at once —
 * the only remaining per-record detail fetch in the pull path (invoices are
 * list-only). This is about overlapping round-trip latency, not the real
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
 * forceFullScan) bypasses it — someone who just fixed a customer's
 * details in Zoho and asked for a pull right now should get one.
 */
const CONTACTS_FULL_SCAN_FLOOR_SECONDS = 15 * 60;

/**
 * How often a brand's invoices are reconciled against Zoho's full list to
 * detect deletions (G-02). Deliberately much coarser than the pull cadence:
 * the normal invoice pull is incremental — it asks only for invoices modified
 * since the cursor — which by construction can never reveal an invoice that
 * has stopped existing. Answering "what does Zoho still have" needs an
 * unfiltered scan of every page, so it is priced accordingly. Deletion is also
 * rare and, unlike a missed status change, not time-critical to within
 * minutes.
 */
const INVOICE_RECONCILE_FLOOR_SECONDS = 60 * 60;

/**
 * How recently a local record may have been created and still be exempt from
 * being treated as deleted in Zoho.
 *
 * Without this the reconciliation races its own sibling pipeline: pushes run on
 * the sync queue concurrently with pulls, so an invoice issued here can be
 * written locally, and its Zoho list scan can complete, before the push that
 * creates it in Zoho actually lands. It would then be absent from the scan
 * purely because it did not exist there yet, and flagging that as a deletion
 * would deactivate the payment link on a brand-new invoice. Ten minutes is far
 * longer than the queue's own backlog under any normal load, and costs nothing
 * — a genuinely deleted invoice is simply caught on the next hourly pass.
 */
const RECONCILE_CREATION_GRACE_MS = 10 * 60 * 1000;

/** Zoho's contact archive flag ('active' | 'inactive', ZohoContactListItem.status)
 * onto our Customer.status. Undefined is a defensive fallback only - Status.All
 * (see listContactsPage) should always return one - and reads as ACTIVE, the
 * same default the column itself has. */
function mapContactStatus(status: string | undefined): 'ACTIVE' | 'ARCHIVED' {
  return status === 'inactive' ? 'ARCHIVED' : 'ACTIVE';
}

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
 * Zoho Books data (contacts, invoices) into the local database, and keeps
 * pulling on a schedule (worker.ts registers this against the
 * 'scheduled-sync' cron already defined in queues.ts).
 *
 * Contacts still get their own per-contact detail fetch (address, business
 * type, and contact persons aren't in the list response at all). Invoices
 * are list-only: only what GET /invoices' list response itself returns
 * (status, totals, dates, customer, invoice number) is pulled — no per-invoice
 * detail fetch, and therefore no line items, tax breakdown or notes from
 * Zoho. Customer payments are not pulled at all; the outbound direction
 * (ZohoSyncService.pushPayment) is how Zoho ever learns a payment happened.
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
   * Whether the record Zoho just handed us is this platform's own push echoing
   * back, rather than a change someone actually made in Zoho.
   *
   * This is what keeps the two pipelines from corrupting each other, and it is
   * needed because they are not inverse operations. pushInvoice sends tax and
   * the card fee to Zoho as ordinary line items — deliberately, since a line
   * item stays neutral on whether the fee is a merchant cost or a customer
   * surcharge — so a pull that reads our own write back rewrote subtotalMinor
   * to silently include them, zeroed taxMinor, replaced one line item with
   * three, and left cardFeeMinor double-counted. Customers had the same shape
   * of problem: upsertCustomer sends only contact_name, but pullOneCustomer
   * reads first_name/last_name back.
   *
   * The comparison is `<=`, not `<`: the version stored at push time IS the
   * timestamp Zoho reported for our own write, so an unchanged record reports
   * exactly equal and must be skipped. Anything strictly newer is a genuine
   * remote edit and is applied as before — Zoho stays authoritative for real
   * changes, which is the whole point of the pull.
   *
   * Both null cases correctly read as "not an echo": no stored version means
   * this platform never pushed the record (or pushed it before the column
   * existed), and Zoho omitting last_modified_time means we cannot tell, so we
   * fall back to the previous always-apply behaviour rather than risk dropping
   * a real change.
   *
   * Contacts check this against the per-contact detail fetch's own
   * last_modified_time (that fetch also covers the customer cascade path — an
   * invoice referencing a contact_id not seen yet never goes through a list
   * at all). Invoices are list-only now, so their check is against the list
   * item's own last_modified_time field instead — no detail fetch to wait
   * for either way.
   */
  /**
   * Runs one per-record pull and decides whether its failure should stop the
   * phase around it.
   *
   * This exists because mapWithConcurrency propagates the first rejection, so
   * before this a single unusable record failed its phase, which failed
   * pullBrand's Promise.all, which meant recordPullRun never ran and the
   * brand's cursor never advanced. The brand's entire sync then stalled
   * permanently on one bad row — and every pull re-fetched the same window and
   * failed the same way. Adding the currency and invoice-number validations
   * made that far easier to trigger: one JPY invoice, or one number collision,
   * was enough to stop a brand syncing at all.
   *
   * The split is by error class, because the two kinds of failure want opposite
   * handling:
   *
   *  - AUTHENTICATION / TRANSIENT are systemic. Whatever is wrong will be wrong
   *    for every remaining record too, and grinding through hundreds more would
   *    hammer a rejected credential or burn the rate limit. These propagate.
   *  - VALIDATION / CONFLICT / PERMANENT are specific to this record. recordPull
   *    has already written a FAILED SyncJob with the provider's own message, so
   *    it is visible in the activity feed; swallowing it here lets the phase
   *    finish, the cursor advance, and every other record land.
   */
  private async pullRecordTolerantly(
    work: () => Promise<boolean>,
    describe: string,
  ): Promise<boolean> {
    try {
      return await work();
    } catch (error) {
      // An unknown error is NOT evidence that this one record is bad. A Prisma
      // connection failure, a Redis outage during rate limiting, a plain
      // programming error — none of those arrive as an IntegrationError, and
      // treating them as record-specific would swallow them, let the phase
      // report success, and let recordPullRun advance the cursor past a window
      // that was never actually pulled. Those records would then never be
      // fetched again: silent data loss, strictly worse than failing the phase
      // and retrying. So tolerance requires a positively identified
      // record-specific class; anything else propagates.
      if (!(error instanceof IntegrationError)) throw error;
      if (error.errorClass === 'AUTHENTICATION' || error.errorClass === 'TRANSIENT') throw error;
      this.logger.warn(`continuing past ${describe}: ${error.errorClass} — ${error.message}`);
      return false;
    }
  }

  /**
   * FR-ZHO-webhook address rules: country is platform-only, and
   * ZohoBooksAdapter.fromZohoAddress always reports it as null since Zoho is
   * never treated as authoritative for it. Overwriting the stored value with
   * that null on every single pull would silently erase a country a
   * merchant entered directly, so this restores whatever was already on the
   * record before Zoho's own fields are applied. `existingJson` is untyped
   * Prisma Json — read defensively rather than trusted as any particular
   * shape.
   */
  private preserveLocalCountry(
    pulled: ReturnType<ZohoBooksAdapter['fromZohoAddress']>,
    existingJson: unknown,
  ): ReturnType<ZohoBooksAdapter['fromZohoAddress']> {
    if (!pulled) return pulled;
    const existingCountry =
      existingJson && typeof existingJson === 'object' && 'country' in existingJson
        ? ((existingJson as { country?: unknown }).country ?? null)
        : null;
    return {
      ...pulled,
      country: typeof existingCountry === 'string' ? existingCountry : null,
    };
  }

  private isOwnPushEcho(
    zohoLastModified: string | undefined,
    syncedVersion: Date | null | undefined,
  ): boolean {
    if (!syncedVersion || !zohoLastModified) return false;
    const remote = new Date(zohoLastModified);
    if (Number.isNaN(remote.getTime())) return false;
    return remote.getTime() <= syncedVersion.getTime();
  }

  /**
   * @param forceFullScan Bypasses CONTACTS_FULL_SCAN_FLOOR_SECONDS — set by
   * the on-demand "pull now" endpoint, never by the scheduled tick.
   */
  async pullBrand(brandId: string, forceFullScan = false): Promise<PullCounts> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-pull');
    if (!scope) return { customers: 0, invoices: 0 };
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return { customers: 0, invoices: 0 };

    const pullStartedAt = new Date();
    const cursor = await this.connections.getLastPulledAt(scope, brandId);

    // The two entity types don't depend on each other's *completion*
    // anymore — pullOneInvoice's cascade into a not-yet-seen customer is
    // upsert-safe now (brandId_zohoContactId / brandId_zohoInvoiceId), the
    // same property that already made mapWithConcurrency safe within a
    // single phase. Running the phases concurrently instead of sequentially
    // overlaps their network waiting time; ZohoBooksAdapter.request's shared
    // per-brand rate limiter is still what caps how much of that time turns
    // into actual Zoho traffic, so this is free concurrency, not more load.
    const [customers, invoices] = await Promise.all([
      this.pullCustomersIfDue(scope, brandId, connection, cursor, forceFullScan),
      this.pullInvoices(scope, brandId, connection, cursor),
      // Deletion detection, on its own much coarser clock. Safe to run
      // alongside the two phases above: it only ever acts on records that
      // predate its own scan by RECONCILE_CREATION_GRACE_MS, so nothing those
      // phases create during this run is in scope for it.
      // Non-fatal on purpose. This is a secondary, hourly concern, and its full
      // unfiltered scan is the most likely of any phase to hit the rate limit —
      // letting it reject would block recordPullRun below and freeze the cursor
      // for the two phases that actually keep data fresh. Its own SyncJob row
      // records the failure, and the next hour retries it.
      this.reconcileInvoicePresenceIfDue(scope, brandId, connection, forceFullScan).catch(
        (error: unknown) => {
          this.logger.warn(
            `invoice deletion reconciliation failed for brand ${brandId} (the pull itself was ` +
              `unaffected): ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      ),
    ]);

    await this.connections.recordPullRun(scope, brandId, pullStartedAt);

    const counts = { customers, invoices };
    this.logger.log(
      `pull complete for brand ${brandId}: ${counts.customers} customers, ${counts.invoices} invoices`,
    );
    return counts;
  }

  /**
   * FR-ZHO-webhook: a targeted, immediate pull of one contact, used by
   * ZohoWebhookService so an inbound event is reflected within seconds
   * rather than waiting for the next scheduled pullBrand tick (which also
   * floors a full contact scan to once per CONTACTS_FULL_SCAN_FLOOR_SECONDS —
   * far too coarse for "near real-time"). Reuses pullOneCustomer as-is: same
   * echo suppression, same field mapping, same SyncJob audit trail, and the
   * same upsert-on-(brandId, zohoContactId) that creates the local row when
   * it does not exist yet (the "new record, single brand" routing case).
   */
  async pullOneCustomerNow(brandId: string, contactId: string): Promise<boolean> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-webhook');
    if (!scope) return false;
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return false;
    return this.pullOneCustomer(scope, brandId, connection, contactId);
  }

  /**
   * FR-ZHO-webhook, invoice side. Unlike contacts, this cannot target the one
   * changed invoice directly — invoices are pulled list-only now (no
   * per-invoice GET), and Zoho's list endpoint has no "by id" filter to ask
   * for just this record. This runs an immediate incremental list-scan for
   * the brand instead (the same call the scheduled tick makes, just run right
   * now rather than waiting for it), which picks up the invoice the webhook
   * named along with anything else modified since the last pull.
   */
  async pullOneInvoiceNow(brandId: string, _invoiceId: string): Promise<boolean> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-webhook');
    if (!scope) return false;
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return false;
    const cursor = await this.connections.getLastPulledAt(scope, brandId);
    const touched = await this.pullInvoices(scope, brandId, connection, cursor);
    return touched > 0;
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
    const { touched, seen } = await this.pullCustomers(scope, brandId, connection, cursor);

    // Contacts are the one entity whose normal pull is already a full scan
    // (there is no server-side modified-time filter to narrow it), so the
    // complete set of contact ids is in hand here for free — no extra Zoho
    // call. Reaching this line also means the scan paginated to completion:
    // mapWithConcurrency and recordPull both propagate, so a partial scan
    // throws rather than returning short. That completeness is exactly the
    // precondition for treating a contact's absence as meaningful.
    // Also non-fatal, and for the same reason: archiving is secondary to having
    // pulled the contacts in the first place, and must not cost us the floor key
    // below (which would make every subsequent pull redo the full scan) or the
    // cursor advance.
    await this.reconcileContactPresence(scope, brandId, seen).catch((error: unknown) => {
      this.logger.warn(
        `contact presence reconciliation failed for brand ${brandId} (the pull itself was ` +
          `unaffected): ${error instanceof Error ? error.message : String(error)}`,
      );
    });

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
  ): Promise<{ touched: number; seen: Array<{ contactId: string; status: string | undefined }> }> {
    return this.recordPull(brandId, 'CUSTOMER', 'list', async () => {
      let page = 1;
      let hasMore = true;
      let touched = 0;
      // Every contact Zoho reported, due or not — reconcileContactPresence
      // needs the full picture, not just the changed subset.
      const seen: Array<{ contactId: string; status: string | undefined }> = [];

      while (hasMore) {
        const { contacts, hasMorePage } = await this.zoho.listContactsPage(connection, page);
        for (const item of contacts) {
          seen.push({ contactId: item.contact_id, status: item.status });
        }
        const due = contacts.filter(
          (item) =>
            !cursor || !item.last_modified_time || new Date(item.last_modified_time) > cursor,
        );
        // Counts records actually written, not records considered — an echo of
        // our own push is fetched and then skipped, and reporting it as pulled
        // would overstate what the run did.
        const applied = await mapWithConcurrency(due, PULL_DETAIL_CONCURRENCY, (item) =>
          this.pullRecordTolerantly(
            () => this.pullOneCustomer(scope, brandId, connection, item.contact_id),
            `Zoho contact ${item.contact_id}`,
          ),
        );
        touched += applied.filter(Boolean).length;
        hasMore = hasMorePage;
        page++;
      }
      return { touched, seen };
    });
  }

  /** Also used as the cascade target when an invoice or payment references a
   * Zoho contact_id we have not seen locally yet. */
  private async pullOneCustomer(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    contactId: string,
  ): Promise<boolean> {
    return this.recordPull(brandId, 'CUSTOMER', contactId, async () => {
      const contact = await this.zoho.getContact(connection, contactId);

      const existing = await this.prisma.withScope(scope, (tx) =>
        tx.customer.findFirst({
          where: { brandId, zohoContactId: contactId },
          select: { zohoSyncedVersion: true, billingAddress: true, shippingAddress: true },
        }),
      );
      if (this.isOwnPushEcho(contact.last_modified_time, existing?.zohoSyncedVersion)) {
        this.logger.debug(
          `skipping Zoho contact ${contactId} — unchanged since this platform's own push`,
        );
        return false;
      }

      const data = {
        type: (contact.customer_sub_type === 'individual' ? 'INDIVIDUAL' : 'BUSINESS') as
          'INDIVIDUAL' | 'BUSINESS',
        displayName: contact.contact_name,
        companyName: contact.company_name ?? null,
        firstName: contact.first_name ?? null,
        lastName: contact.last_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        status: mapContactStatus(contact.status),
        billingAddress: (this.preserveLocalCountry(
          this.zoho.fromZohoAddress(contact.billing_address),
          existing?.billingAddress,
        ) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        shippingAddress: (this.preserveLocalCountry(
          this.zoho.fromZohoAddress(contact.shipping_address),
          existing?.shippingAddress,
        ) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
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
      await this.prisma.withScope(scope, async (tx) => {
        const row = await tx.customer.upsert({
          where: { brandId_zohoContactId: { brandId, zohoContactId: contactId } },
          create: { ...data, brandId, zohoContactId: contactId },
          update: data,
        });

        // Same recipe as pullOneInvoice's line items, for the same reason:
        // upsert each contact person individually (race-safe the same way
        // the customer row above is — customerId_zohoContactPersonId is a
        // real constraint), then a plain delete for the ones no longer
        // present, scoped by id rather than a naive wipe-and-recreate.
        const contactPersons = contact.contact_persons ?? [];
        for (const person of contactPersons) {
          const personData = {
            salutation: person.salutation ?? null,
            firstName: person.first_name,
            lastName: person.last_name ?? null,
            email: person.email ?? null,
            phone: person.phone ?? null,
            mobile: person.mobile ?? null,
            skype: person.skype ?? null,
            designation: person.designation ?? null,
            department: person.department ?? null,
            isPrimaryContact: person.is_primary_contact ?? false,
          };
          await tx.customerContactPerson.upsert({
            where: {
              customerId_zohoContactPersonId: {
                customerId: row.id,
                zohoContactPersonId: person.contact_person_id,
              },
            },
            create: {
              ...personData,
              customerId: row.id,
              zohoContactPersonId: person.contact_person_id,
            },
            update: personData,
          });
        }
        // notIn: [] (Zoho now reports zero contact persons) correctly
        // matches every existing Zoho-sourced row here, not none — SQL's
        // NULL semantics keep any locally-created contact person (a future
        // possibility; zohoContactPersonId null) out of this filter either way.
        await tx.customerContactPerson.deleteMany({
          where: {
            customerId: row.id,
            zohoContactPersonId: { notIn: contactPersons.map((p) => p.contact_person_id) },
          },
        });
      });
      return true;
    });
  }

  /**
   * Reconciles local customers against the set of contacts Zoho actually
   * reports (G-09), in both directions:
   *
   *  - present locally, absent from Zoho entirely  -> ARCHIVED
   *  - reported by Zoho as inactive                -> ARCHIVED
   *  - reported by Zoho as active but locally archived -> ACTIVE again
   *
   * Archived, never deleted, because nothing financial is hard-deleted here
   * (see the schema header) and because Zoho itself only permits deleting a
   * contact no invoice references — a contact that vanishes may well still have
   * invoices pointing at it locally. This is also what finally makes
   * CustomersService.list's own comment true: it has always filtered archived
   * customers out on the stated grounds that ZohoPullService archives the ones
   * Zoho stops reporting, which until now nothing actually did.
   *
   * The diff is computed in memory rather than as a `notIn` against every seen
   * id: a brand with thousands of contacts would otherwise build an enormous
   * IN list, whereas the sets that actually need writing are small.
   */
  private async reconcileContactPresence(
    scope: Scope,
    brandId: string,
    seen: ReadonlyArray<{ contactId: string; status: string | undefined }>,
  ): Promise<void> {
    // An empty result is not trustworthy evidence that a brand has no contacts
    // — it is equally consistent with a scan that returned nothing for a reason
    // this code cannot see. Archiving a brand's entire customer list on that
    // basis is far worse than waiting for the next pass.
    if (seen.length === 0) {
      this.logger.warn(
        `skipping contact reconciliation for brand ${brandId} — Zoho reported no contacts at all`,
      );
      return;
    }

    const activeInZoho = new Set(
      seen.filter((c) => mapContactStatus(c.status) === 'ACTIVE').map((c) => c.contactId),
    );
    const knownToZoho = new Set(seen.map((c) => c.contactId));

    const local = await this.prisma.withScope(scope, (tx) =>
      tx.customer.findMany({
        where: { brandId, zohoContactId: { not: null } },
        select: { id: true, zohoContactId: true, status: true, createdAt: true },
      }),
    );

    const createdBefore = new Date(Date.now() - RECONCILE_CREATION_GRACE_MS);
    const toArchive: string[] = [];
    const toActivate: string[] = [];

    for (const row of local) {
      const contactId = row.zohoContactId!;
      const shouldBeActive = activeInZoho.has(contactId);

      // Same race guard as the invoice reconciliation: a customer created here
      // moments ago may not have been pushed to Zoho yet, so its absence from
      // the scan says nothing.
      if (!knownToZoho.has(contactId) && row.createdAt > createdBefore) continue;

      if (!shouldBeActive && row.status === 'ACTIVE') toArchive.push(row.id);
      if (shouldBeActive && row.status === 'ARCHIVED') toActivate.push(row.id);
    }

    if (toArchive.length > 0) {
      await this.prisma.withScope(scope, (tx) =>
        tx.customer.updateMany({ where: { id: { in: toArchive } }, data: { status: 'ARCHIVED' } }),
      );
      this.logger.log(
        `archived ${toArchive.length} customer(s) for brand ${brandId} — Zoho no longer reports them as active`,
      );
    }
    if (toActivate.length > 0) {
      await this.prisma.withScope(scope, (tx) =>
        tx.customer.updateMany({ where: { id: { in: toActivate } }, data: { status: 'ACTIVE' } }),
      );
      this.logger.log(
        `re-activated ${toActivate.length} customer(s) for brand ${brandId} — present and active in Zoho again`,
      );
    }
  }

  /** Same floor-plus-force shape as the contacts and payments scans. */
  private async reconcileInvoicePresenceIfDue(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
    force: boolean,
  ): Promise<void> {
    const floorKey = `zoho:invoices-reconciled:${brandId}`;
    if (!force && (await this.redis.getJson<boolean>(floorKey))) return;
    try {
      await this.reconcileInvoicePresence(scope, brandId, connection);
    } finally {
      // In a finally, not after a success: this scan is a full unfiltered pass
      // over every invoice, and it is the phase most likely to be rate limited.
      // Setting the floor only on success meant a failing reconciliation
      // re-scanned on every single pull — once a minute for a brand on
      // "Realtime" — which is exactly the traffic the floor exists to prevent,
      // and would keep re-triggering the very rate limit that failed it. Backing
      // off for the normal interval on failure too turns a self-worsening loop
      // into an hourly retry.
      await this.redis
        .setJson(floorKey, true, INVOICE_RECONCILE_FLOOR_SECONDS)
        .catch(() => undefined);
    }
  }

  /**
   * Detects invoices deleted in Zoho and stops them being collectable here
   * (G-02 — the one open gap that could take real money for a record Zoho no
   * longer has).
   *
   * A deleted invoice previously kept its status, its publicToken and
   * publicTokenActive: true, so a customer holding the payment link could still
   * pay an invoice that had been removed from the books. Setting
   * publicTokenActive false is what actually closes that, since
   * PublicInvoicesService.resolveScope already refuses an inactive token.
   *
   * Status is deliberately NOT changed. This infers deletion from silence, and
   * an unfiltered list is the only evidence available; if Zoho ever applies an
   * unexpected default filter to the invoice list, that inference is wrong.
   * Deactivating a token is reversible and costs a merchant one re-send, while
   * rewriting an invoice's status on a false positive corrupts the ledger. So
   * absence stops collection and records a flag a human can act on, and the
   * flag is cleared — reactivating the token — if the invoice turns up again.
   */
  private async reconcileInvoicePresence(
    scope: Scope,
    brandId: string,
    connection: AccountingConnection,
  ): Promise<void> {
    await this.recordPull(
      brandId,
      'INVOICE',
      'reconcile',
      async () => {
        // Explicitly no cursor: an incremental fetch cannot answer "what does
        // Zoho still have", which is the entire question here.
        let page = 1;
        let hasMore = true;
        const seen = new Set<string>();
        while (hasMore) {
          const { invoices, hasMorePage } = await this.zoho.listInvoicesPage(
            connection,
            page,
            null,
          );
          for (const item of invoices) seen.add(item.invoice_id);
          hasMore = hasMorePage;
          page++;
        }

        // Same reasoning as the contact scan: nothing at all is not evidence of
        // deletion, and acting on it would deactivate every payment link a brand
        // has.
        if (seen.size === 0) {
          this.logger.warn(
            `skipping invoice reconciliation for brand ${brandId} — Zoho reported no invoices at all`,
          );
          return false;
        }

        const local = await this.prisma.withScope(scope, (tx) =>
          tx.invoice.findMany({
            where: { brandId, zohoInvoiceId: { not: null } },
            select: {
              id: true,
              number: true,
              zohoInvoiceId: true,
              zohoMissingSince: true,
              createdAt: true,
            },
          }),
        );

        const createdBefore = new Date(Date.now() - RECONCILE_CREATION_GRACE_MS);
        const nowMissing = local.filter(
          (row) =>
            !seen.has(row.zohoInvoiceId!) &&
            row.zohoMissingSince === null &&
            row.createdAt <= createdBefore,
        );
        const reappeared = local.filter(
          (row) => seen.has(row.zohoInvoiceId!) && row.zohoMissingSince !== null,
        );

        if (nowMissing.length > 0) {
          await this.prisma.withScope(scope, (tx) =>
            tx.invoice.updateMany({
              where: { id: { in: nowMissing.map((r) => r.id) } },
              data: { zohoMissingSince: new Date(), publicTokenActive: false },
            }),
          );
          this.logger.warn(
            `brand ${brandId}: ${nowMissing.length} invoice(s) no longer exist in Zoho — ` +
              `payment links deactivated (${nowMissing.map((r) => r.number).join(', ')})`,
          );
        }
        if (reappeared.length > 0) {
          await this.prisma.withScope(scope, (tx) =>
            tx.invoice.updateMany({
              where: { id: { in: reappeared.map((r) => r.id) } },
              data: { zohoMissingSince: null, publicTokenActive: true },
            }),
          );
          this.logger.log(
            `brand ${brandId}: ${reappeared.length} invoice(s) present in Zoho again — ` +
              `payment links restored`,
          );
        }
        return true;
      },
      { skippedWhen: (applied) => applied === false },
    );
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
        // No per-item Zoho call here (list-only), so there is no round-trip
        // latency to overlap and no need for mapWithConcurrency — a plain
        // sequential loop over the page is enough.
        for (const item of invoices) {
          const applied = await this.pullRecordTolerantly(
            () => this.pullOneInvoice(scope, brandId, connection, item),
            `Zoho invoice ${item.invoice_id}`,
          );
          if (applied) touched++;
        }
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
    item: ZohoInvoiceListItem,
  ): Promise<boolean> {
    const invoiceId = item.invoice_id;
    return this.recordPull(
      brandId,
      'INVOICE',
      invoiceId,
      async () => {
        // Before anything else, and before the cascade below spends further
        // calls: an invoice unchanged since this platform's own push is our own
        // write coming back, and applying it is what corrupted the money fields.
        const existing = await this.prisma.withScope(scope, (tx) =>
          tx.invoice.findFirst({
            where: { brandId, zohoInvoiceId: invoiceId },
            select: { zohoSyncedVersion: true },
          }),
        );
        if (this.isOwnPushEcho(item.last_modified_time, existing?.zohoSyncedVersion)) {
          this.logger.debug(
            `skipping Zoho invoice ${invoiceId} — unchanged since this platform's own push`,
          );
          return false;
        }

        let customerId = await this.localCustomerId(scope, brandId, item.customer_id);
        if (!customerId) {
          await this.pullOneCustomer(scope, brandId, connection, item.customer_id);
          customerId = await this.localCustomerId(scope, brandId, item.customer_id);
        }
        if (!customerId) {
          throw new IntegrationError({
            message: `invoice ${invoiceId} references Zoho contact ${item.customer_id}, which could not be pulled`,
            errorClass: 'VALIDATION',
            provider: 'zoho-books',
          });
        }

        // Zoho returns whatever currency the merchant's own books use, and until
        // now that string was stored raw and every amount converted as if it were
        // 2-decimal. A JPY invoice therefore imported at 100x its real value,
        // labelled with a currency the rest of the platform cannot even format
        // (formatMinor would look up an undefined exponent). Refusing the invoice
        // outright is the honest outcome: one clearly-failed SyncJob naming the
        // currency, rather than a silently wrong number in the ledger. Widening
        // SUPPORTED_CURRENCIES is what makes such an invoice importable.
        if (!isSupportedCurrency(item.currency_code)) {
          throw new IntegrationError({
            message:
              `invoice ${invoiceId} is denominated in ${item.currency_code}, which this ` +
              `platform does not support — it cannot be represented without corrupting the amount`,
            errorClass: 'VALIDATION',
            provider: 'zoho-books',
          });
        }
        const currency: CurrencyCode = item.currency_code;
        const totalMinor = BigInt(this.zoho.decimalToMinor(item.total, currency));
        const balanceMinor = BigInt(this.zoho.decimalToMinor(item.balance, currency));

        // Header fields only — list-only pull, no per-invoice detail fetch.
        // subtotalMinor/taxMinor/taxRateBpApplied/notes are NOT in this data:
        // left untouched on an update (whatever's already stored, whether from
        // a locally-authored invoice or an earlier detail-backed pull, stays as
        // is), and given a best-effort default on create (see below) since the
        // exact breakdown isn't available from the list response.
        const updateData = {
          customerId,
          number: item.invoice_number,
          status: INVOICE_STATUS_MAP[item.status] ?? 'SENT',
          invoiceDate: new Date(item.date),
          dueDate: new Date(item.due_date),
          currency,
          totalMinor,
          balanceMinor,
        };

        // Upserting on brandId_zohoInvoiceId — the same idea as pullOneCustomer's:
        // Postgres compiles it to a real INSERT ... ON CONFLICT
        // (brand_id, zoho_invoice_id) DO UPDATE, atomic against two concurrent
        // calls for the same not-yet-seen invoice_id.
        //
        // The one case that ON CONFLICT does NOT absorb is this invoice also
        // colliding on a *different* unique constraint, (brand_id, number):
        // both concurrent calls fetched the same Zoho invoice, so they propose
        // the identical invoice_number too. Postgres only arbitrates the
        // constraint actually named in ON CONFLICT; a second, incidental
        // collision on `number` is checked with ordinary (non-speculative)
        // insertion semantics, and — confirmed against the real database, not
        // assumed — can raise a genuine unique-violation error on *either or
        // both* concurrent callers even though the row they're each trying to
        // write is, semantically, the exact same invoice. withUniqueViolationRetry
        // exists for exactly this: a retried call re-resolves brandId_zohoInvoiceId
        // against the now-committed winner and takes the UPDATE branch, which
        // touches no other unique index at all.
        //
        // `number` is declared non-retryable below. Unlike a zohoInvoiceId
        // conflict — a genuine race a retry resolves — a collision on
        // (brandId, number) means Zoho's invoice number is already held by a
        // *different* local invoice, usually one this platform numbered from
        // its own sequence. Retrying cannot change that, so it used to burn all
        // five attempts and then surface a raw Prisma error.
        await this.withUniqueViolationRetry(
          () =>
            this.prisma.withScope(scope, (tx) =>
              tx.invoice.upsert({
                where: { brandId_zohoInvoiceId: { brandId, zohoInvoiceId: invoiceId } },
                create: {
                  ...updateData,
                  brandId,
                  zohoInvoiceId: invoiceId,
                  publicToken: this.randomPublicToken(),
                  cardFeeRateBpApplied: 0,
                  cardFeeMinor: 0n,
                  // Best-effort defaults for fields the list response doesn't
                  // carry — only reachable on create, since an update leaves
                  // these alone entirely.
                  subtotalMinor: totalMinor,
                  taxRateBpApplied: 0,
                  taxMinor: 0n,
                  notes: null,
                },
                update: updateData,
              }),
            ),
          5,
          ['number'],
        ).catch((error: unknown) => {
          if (PrismaService.isUniqueViolation(error, 'number')) {
            throw new IntegrationError({
              message:
                `Zoho invoice ${invoiceId} uses number "${item.invoice_number}", which ` +
                `already belongs to a different invoice on this brand — the Zoho-sourced and ` +
                `locally generated number sequences have collided, and one of them has to change`,
              errorClass: 'VALIDATION',
              provider: 'zoho-books',
            });
          }
          throw error;
        });
        return true;
      },
      { skippedWhen: (applied) => applied === false },
    );
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
    nonRetryableTargets: readonly string[] = [],
  ): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await work();
      } catch (error) {
        // Not every unique violation is a race. Retrying one that isn't just
        // multiplies a single permanent failure into `attempts` of them and
        // delays the error the caller actually needs to see.
        if (nonRetryableTargets.some((t) => PrismaService.isUniqueViolation(error, t))) throw error;
        if (attempt === attempts || !PrismaService.isUniqueViolation(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
      }
    }
    // Unreachable — the loop above always either returns or throws — but
    // TypeScript can't see that a for-loop with no fallthrough always exits.
    throw new Error('withUniqueViolationRetry: exhausted attempts without a result');
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

  // --- SyncJob recording -----------------------------------------------------

  /** Mirrors ZohoSyncService.runJob but for direction: PULL — kept as its
   * own small copy rather than shared, so a change to the push path's
   * retry/recording behaviour cannot silently alter the pull path's. */
  private async recordPull<T>(
    brandId: string,
    objectType: 'CUSTOMER' | 'INVOICE',
    objectId: string,
    work: () => Promise<T>,
    options?: { readonly skippedWhen?: (result: T) => boolean },
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
      // An explicit predicate rather than treating any falsy result as a skip:
      // the list wrappers legitimately return 0 for "nothing had changed", which
      // is a real success, not a refusal to represent something.
      const skipped = options?.skippedWhen?.(result) ?? false;
      // Guarded: the work has already happened. Letting the audit write's own
      // failure escape would turn a completed pull into a failure, and the
      // caller would retry work that already succeeded.
      try {
        await this.prisma.withoutScope(
          `recording pull job success for brand ${brandId}`,
          (client) =>
            client.syncJob.update({
              where: { id: job.id },
              data: { status: skipped ? 'SKIPPED' : 'SUCCEEDED', completedAt: new Date() },
            }),
        );
      } catch (auditError) {
        this.logger.warn(
          `pull succeeded for brand ${brandId} but its SyncJob row could not be updated: ` +
            `${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }
      return result;
    } catch (error) {
      const integrationError = error instanceof IntegrationError ? error : null;
      // Guarded for the same reason markUnhealthy below is: if the database is
      // the thing that is unwell, recording *why* we failed will fail too, and
      // an unguarded write here would surface that instead of the Zoho error —
      // which is what pullRecordTolerantly and the queue's retry policy both
      // read to decide what to do next.
      try {
        await this.prisma.withoutScope(
          `recording pull job failure for brand ${brandId}`,
          (client) =>
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
      } catch (auditError) {
        this.logger.warn(
          `could not record pull failure for brand ${brandId}: ` +
            `${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }
      this.logger.warn(
        `Zoho pull failed — brand ${brandId}, ${objectType} ${objectId}: ${error instanceof Error ? error.message : error}`,
      );

      // Same reasoning as the push path's own copy of this: a rejected
      // credential is the failure an operator has to act on, and it was
      // previously invisible behind a connection that still read "Healthy".
      // Guarded so that recording *why* we failed can never replace *what*
      // failed. Unguarded, a scope resolution or database hiccup in here would
      // surface instead of the Zoho error the caller and the retry policy
      // actually need to see.
      if (integrationError?.errorClass === 'AUTHENTICATION') {
        try {
          const healthScope = await this.systemScope.forBrand(brandId, 'zoho-pull-health');
          if (healthScope) {
            await this.connections.markUnhealthy(
              healthScope,
              brandId,
              integrationError.providerMessage ?? integrationError.message,
            );
          }
        } catch (healthError) {
          this.logger.warn(
            `could not record unhealthy state for brand ${brandId}: ` +
              `${healthError instanceof Error ? healthError.message : String(healthError)}`,
          );
        }
      }
      throw error;
    }
  }
}
