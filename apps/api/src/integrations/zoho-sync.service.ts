import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type {
  AccountingAddress,
  AccountingConnection,
  AccountingCustomer,
  AccountingInvoice,
  AccountingPayment,
  IntegrationError as IntegrationErrorType,
  Scope,
} from '@fenwick/shared';
import { IntegrationError, isSupportedCurrency } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { SystemScopeResolver } from '../tenancy/system-scope.js';
import { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import { IntegrationConnectionService } from './integration-connection.service.js';

export interface BackfillCounts {
  readonly customers: number;
  readonly invoices: number;
  readonly payments: number;
}

/** Terminal-success payment states — the same set the live SETTLE_FULL
 * trigger fires on, so backfill and steady-state never disagree about what
 * counts as "settled enough to push". */
const SETTLED_PAYMENT_STATUSES = ['SETTLED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

interface BackfillPayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly customerId: string;
}
interface BackfillInvoice {
  readonly id: string;
  readonly customerId: string;
}
interface BackfillCustomer {
  readonly id: string;
}

/**
 * Pure — no DB, no queue, no Zoho — so the exclusion rule that closes the
 * duplicate-push race (see enqueueBackfill's doc comment) can be verified
 * directly against synthetic data rather than only by reasoning about it.
 */
export function computeBackfillTargets(input: {
  payments: readonly BackfillPayment[];
  invoices: readonly BackfillInvoice[];
  customers: readonly BackfillCustomer[];
}): {
  customersToEnqueue: readonly BackfillCustomer[];
  invoicesToEnqueue: readonly BackfillInvoice[];
  payments: readonly BackfillPayment[];
} {
  const { payments, invoices, customers } = input;

  const invoiceIdsCoveredByPayments = new Set(payments.map((p) => p.invoiceId));
  const invoicesToEnqueue = invoices.filter((i) => !invoiceIdsCoveredByPayments.has(i.id));

  const customerIdsCovered = new Set([
    ...payments.map((p) => p.customerId),
    ...invoicesToEnqueue.map((i) => i.customerId),
  ]);
  const customersToEnqueue = customers.filter((c) => !customerIdsCovered.has(c.id));

  return { customersToEnqueue, invoicesToEnqueue, payments };
}

/**
 * FR-ZHO-011/012, TDD-001 §10.4 and §11.1. Each push method ensures its own
 * prerequisite exists in Zoho first — a payment cannot reference an invoice
 * that is not there yet, an invoice cannot reference a customer that is not
 * there yet — so pushing a payment is enough to cascade the whole chain into
 * existence regardless of which order jobs happen to run in.
 *
 * A brand with no Zoho connection is not an error: every method returns
 * quietly. Whether to push at all is a per-brand fact, not a per-call one.
 */
@Injectable()
export class ZohoSyncService {
  private readonly logger = new Logger(ZohoSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoBooksAdapter,
    private readonly connections: IntegrationConnectionService,
    private readonly systemScope: SystemScopeResolver,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
  ) {}

  /**
   * FR-ZHO-013: everything that existed before this brand connected — not
   * just what happens from here on. Scoped to records with no zoho*Id yet, so
   * running this again after a partial failure (or just to be sure) only
   * queues what still needs it, rather than re-pushing everything already
   * synced.
   *
   * Draft invoices are excluded — nothing has been shown to the customer yet,
   * so there is nothing for Zoho to reflect. Payments are limited to states
   * that ever reached settlement, matching the live trigger in
   * PaymentsService exactly.
   *
   * An invoice already covered by one of the payment jobs below is NOT also
   * given its own direct job, and likewise a customer already covered by one
   * of the invoice jobs — pushInvoice/pushPayment cascade to their
   * prerequisite inline, and two jobs racing to inline-push the same
   * never-synced customer or invoice at once would create a duplicate
   * contact or invoice in Zoho. This closes that race for the common shape
   * (one payment per invoice, one invoice's worth of history per customer).
   * It does not fully close it for an invoice with more than one settled
   * payment still unsynced — those payment jobs can still race each other to
   * push the same invoice. Accepted here: Zoho is a downstream mirror, not
   * the ledger of record, so the worst case is a duplicate entry a bookkeeper
   * merges by hand, not a financial error.
   */
  async enqueueBackfill(
    brandId: string,
    opts?: { readonly skipPayments?: boolean },
  ): Promise<BackfillCounts> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-backfill');
    if (!scope) throw new ConflictException('unknown brand');

    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) throw new ConflictException('brand is not connected to Zoho');

    // computeBackfillTargets treats an empty payments array correctly on its
    // own: with nothing covering them, every eligible invoice is pushed
    // directly instead of via a payment's cascade — no other branching needed.
    const skipPayments = opts?.skipPayments ?? false;

    const [rawPayments, invoices, customers] = await this.prisma.withScope(scope, (tx) =>
      Promise.all([
        skipPayments
          ? Promise.resolve<
              Array<{ id: string; invoiceId: string; invoice: { customerId: string } }>
            >([])
          : tx.payment.findMany({
              where: {
                brandId,
                zohoPaymentId: null,
                status: { in: [...SETTLED_PAYMENT_STATUSES] },
              },
              select: { id: true, invoiceId: true, invoice: { select: { customerId: true } } },
            }),
        tx.invoice.findMany({
          where: { brandId, zohoInvoiceId: null, status: { not: 'DRAFT' } },
          select: { id: true, customerId: true },
        }),
        tx.customer.findMany({ where: { brandId, zohoContactId: null }, select: { id: true } }),
      ]),
    );
    const payments = rawPayments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      customerId: p.invoice.customerId,
    }));

    const { customersToEnqueue, invoicesToEnqueue } = computeBackfillTargets({
      payments,
      invoices,
      customers,
    });

    await Promise.all([
      ...customersToEnqueue.map((c) =>
        this.queue.enqueue('sync', 'zoho-push-customer', { brandId, customerId: c.id }),
      ),
      ...invoicesToEnqueue.map((i) =>
        this.queue.enqueue('sync', 'zoho-push-invoice', { brandId, invoiceId: i.id }),
      ),
      ...payments.map((p) =>
        this.queue.enqueue('sync', 'zoho-push-payment', { brandId, paymentId: p.id }),
      ),
    ]);

    const counts = {
      customers: customersToEnqueue.length,
      invoices: invoicesToEnqueue.length,
      payments: payments.length,
    };
    this.logger.log(
      `backfill queued for brand ${brandId}: ${counts.customers} customers, ${counts.invoices} invoices, ${counts.payments} payments`,
    );
    return counts;
  }

  /**
   * `viaCascade` distinguishes two different callers with genuinely
   * different rules: a standalone push (backfill, or a customer created
   * while connected) honours customerSyncEnabled, since that toggle exists
   * to mean "don't mirror my customer list." An invoice or payment push
   * calling this to satisfy its own hard prerequisite — Zoho cannot hold an
   * invoice with no contact behind it — is not that; disabling customer
   * sync must not silently turn every invoice push into a guaranteed
   * "customer push did not yield a Zoho contact id" failure while invoice
   * sync is nominally still on.
   */
  async pushCustomer(
    brandId: string,
    customerId: string,
    opts?: { readonly viaCascade?: boolean },
  ): Promise<void> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-sync');
    if (!scope) return;
    const connection = await this.resolveConnection(scope, brandId, 'CUSTOMER', customerId);
    if (!connection) return;
    if (!opts?.viaCascade) {
      const flags = await this.connections.getSyncFlags(scope, brandId);
      if (flags && !flags.customerSyncEnabled) return;
    }

    await this.runJob(scope, brandId, 'CUSTOMER', customerId, async () => {
      const customer = await this.prisma.withScope(scope, (tx) =>
        tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { brand: true } }),
      );

      const dto: AccountingCustomer = {
        localId: customer.id,
        remoteId: customer.zohoContactId,
        type: customer.type,
        displayName: customer.displayName,
        companyName: customer.companyName,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        billingAddress: customer.billingAddress as unknown as AccountingAddress | null,
        shippingAddress: customer.shippingAddress as unknown as AccountingAddress | null,
        currency: customer.brand.currency as AccountingCustomer['currency'],
      };

      const unsyncedReason = this.validateCustomerForSync(dto);
      if (unsyncedReason) {
        await this.markUnsynced(scope, 'customer', customer.id, unsyncedReason);
        throw new IntegrationError({
          message: unsyncedReason,
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      }

      // FR-ZHO-webhook loop prevention: written before the outbound call so
      // the webhook Zoho fires right back for this same write — recognised
      // by ZohoWebhookService via the same (brandId, customer.id, 'customer')
      // key — is dropped as a duplicate instead of being re-applied.
      await this.redis.markSyncAction(brandId, customer.id, 'customer');
      const result = await this.zoho.upsertCustomer(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.customer.update({
          where: { id: customer.id },
          data: {
            zohoContactId: result.remoteId,
            // Zoho's own last_modified_time for the record we just wrote, so
            // the next pull can recognise this write coming back rather than
            // treating it as a remote edit and overwriting firstName/lastName
            // with whatever Zoho derived from contact_name (Customer
            // .zohoSyncedVersion in schema.prisma spells out why).
            zohoSyncedVersion: result.updatedAt ?? null,
            zohoUnsyncedReason: null,
          },
        }),
      );
    });
  }

  async pushInvoice(brandId: string, invoiceId: string): Promise<void> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-sync');
    if (!scope) return;
    const connection = await this.resolveConnection(scope, brandId, 'INVOICE', invoiceId);
    if (!connection) return;
    const flags = await this.connections.getSyncFlags(scope, brandId);
    if (flags && !flags.invoiceSyncEnabled) return;

    await this.runJob(scope, brandId, 'INVOICE', invoiceId, async () => {
      const invoice = await this.prisma.withScope(scope, (tx) =>
        tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: { lineItems: { orderBy: { position: 'asc' } }, customer: true, taxRate: true },
        }),
      );

      if (!invoice.customer.zohoContactId) {
        await this.pushCustomer(brandId, invoice.customerId, { viaCascade: true });
      }
      const customerRemoteId = (
        await this.prisma.withScope(scope, (tx) =>
          tx.customer.findUniqueOrThrow({
            where: { id: invoice.customerId },
            select: { zohoContactId: true },
          }),
        )
      ).zohoContactId;
      if (!customerRemoteId) {
        throw new IntegrationError({
          message: 'customer push did not yield a Zoho contact id',
          errorClass: 'PERMANENT',
          provider: 'zoho-books',
        });
      }

      const dto: AccountingInvoice = {
        localId: invoice.id,
        remoteId: invoice.zohoInvoiceId,
        number: invoice.number,
        customerRemoteId,
        currency: invoice.currency as AccountingInvoice['currency'],
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        lines: invoice.lineItems.map((line) => ({
          name: line.itemName,
          description: line.description,
          quantity: line.quantity,
          unitPriceMinor: Number(line.unitPriceMinor),
          lineTotalMinor: Number(line.lineTotalMinor),
          taxExempt: line.taxExempt,
          remoteTaxId: invoice.taxRate?.zohoTaxId ?? null,
        })),
        subtotalMinor: Number(invoice.subtotalMinor),
        taxRateBpApplied: invoice.taxRateBpApplied,
        taxMinor: Number(invoice.taxMinor),
        cardFeeMinor: Number(invoice.cardFeeMinor),
        totalMinor: Number(invoice.totalMinor),
        notes: invoice.notes,
        status: this.toAccountingInvoiceStatus(invoice.status),
      };

      const unsyncedReason = this.validateInvoiceForSync(dto);
      if (unsyncedReason) {
        await this.markUnsynced(scope, 'invoice', invoice.id, unsyncedReason);
        throw new IntegrationError({
          message: unsyncedReason,
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      }

      // See pushCustomer's own comment on this same call.
      await this.redis.markSyncAction(brandId, invoice.id, 'invoice');
      const result = await this.zoho.pushInvoice(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.invoice.update({
          where: { id: invoice.id },
          data: {
            zohoInvoiceId: result.remoteId,
            // The load-bearing half of echo suppression: tax and the card fee
            // went to Zoho as ordinary line items, so without this the next
            // pull reads our own write back as a changed invoice and rewrites
            // subtotalMinor to include them. See Invoice.zohoSyncedVersion.
            zohoSyncedVersion: result.updatedAt ?? null,
            zohoUnsyncedReason: null,
          },
        }),
      );
    });
  }

  // No separate "Payment Synchronization" toggle exists (or would mean much):
  // a payment cannot be pushed without the invoice it settles already
  // existing in Zoho, so payment push rides on invoiceSyncEnabled rather
  // than a third, functionally-identical flag.
  async pushPayment(brandId: string, paymentId: string): Promise<void> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-sync');
    if (!scope) return;
    const connection = await this.resolveConnection(scope, brandId, 'PAYMENT', paymentId);
    if (!connection) return;
    const flags = await this.connections.getSyncFlags(scope, brandId);
    if (flags && !flags.invoiceSyncEnabled) return;

    await this.runJob(scope, brandId, 'PAYMENT', paymentId, async () => {
      const payment = await this.prisma.withScope(scope, (tx) =>
        tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { invoice: { include: { customer: true } } },
        }),
      );

      if (!payment.invoice.zohoInvoiceId) {
        await this.pushInvoice(brandId, payment.invoiceId);
      }
      const refreshed = await this.prisma.withScope(scope, (tx) =>
        tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { invoice: { include: { customer: true } } },
        }),
      );
      const invoiceRemoteId = refreshed.invoice.zohoInvoiceId;
      const customerRemoteId = refreshed.invoice.customer.zohoContactId;
      if (!invoiceRemoteId || !customerRemoteId) {
        throw new IntegrationError({
          message: 'invoice or customer push did not yield the remote ids this payment needs',
          errorClass: 'PERMANENT',
          provider: 'zoho-books',
        });
      }

      const dto: AccountingPayment = {
        localId: refreshed.id,
        remoteId: refreshed.zohoPaymentId,
        invoiceRemoteId,
        customerRemoteId,
        amountMinor: Number(refreshed.amountMinor),
        currency: refreshed.currency as AccountingPayment['currency'],
        settledAt: refreshed.settledAt ?? refreshed.createdAt,
        method: refreshed.method,
        reference: refreshed.gatewayReference,
      };

      const unsyncedReason = this.validatePaymentForSync(dto);
      if (unsyncedReason) {
        await this.markUnsynced(scope, 'payment', refreshed.id, unsyncedReason);
        throw new IntegrationError({
          message: unsyncedReason,
          errorClass: 'VALIDATION',
          provider: 'zoho-books',
        });
      }

      // See pushCustomer's own comment on this same call. Payment sync is
      // platform → Zoho only, so this key only ever guards against a
      // duplicate redelivery of the invoice.status_updated echo it causes —
      // there is no separate payment webhook to drop (FR-ZHO-webhook).
      await this.redis.markSyncAction(brandId, refreshed.id, 'payment');
      const result = await this.zoho.pushPayment(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.payment.update({
          where: { id: refreshed.id },
          data: { zohoPaymentId: result.remoteId, zohoUnsyncedReason: null },
        }),
      );
    });
  }

  /** FR-ZHO-webhook mandatory-field check. Only what Zoho's own Create
   * Contact would itself reject as incomplete — everything else is optional
   * both here and there. */
  private validateCustomerForSync(customer: AccountingCustomer): string | null {
    if (!customer.displayName.trim()) return 'customer has no display name';
    return null;
  }

  /** FR-ZHO-webhook mandatory-field check. The currency rule mirrors
   * ZohoPullService's own refusal of an unsupported-currency invoice
   * (isSupportedCurrency) — the same corruption risk applies in reverse:
   * pushing an amount under the wrong currency label misrepresents it in
   * Zoho just as importing one would here. */
  private validateInvoiceForSync(invoice: AccountingInvoice): string | null {
    if (!isSupportedCurrency(invoice.currency)) {
      return `invoice currency ${invoice.currency} is not supported for Zoho sync`;
    }
    if (invoice.lines.length === 0) return 'invoice has no line items';
    if (!invoice.number.trim()) return 'invoice has no invoice number';
    if (!invoice.customerRemoteId) return 'invoice has no synced customer to bill';
    return null;
  }

  private validatePaymentForSync(payment: AccountingPayment): string | null {
    if (payment.amountMinor <= 0) return 'payment amount must be greater than zero';
    if (!isSupportedCurrency(payment.currency)) {
      return `payment currency ${payment.currency} is not supported for Zoho sync`;
    }
    return null;
  }

  /** FR-ZHO-webhook "Outbound... mandatory fields": recorded on the record
   * itself (not just the SyncJob row runJob writes below) so the reason is
   * visible wherever that customer/invoice/payment itself is shown, not only
   * on the Sync Dashboard. */
  private async markUnsynced(
    scope: Scope,
    kind: 'customer' | 'invoice' | 'payment',
    id: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.withScope(scope, async (tx) => {
      if (kind === 'customer') {
        await tx.customer.update({ where: { id }, data: { zohoUnsyncedReason: reason } });
      } else if (kind === 'invoice') {
        await tx.invoice.update({ where: { id }, data: { zohoUnsyncedReason: reason } });
      } else {
        await tx.payment.update({ where: { id }, data: { zohoUnsyncedReason: reason } });
      }
    });
  }

  private toAccountingInvoiceStatus(status: string): AccountingInvoice['status'] {
    switch (status) {
      case 'DRAFT':
        return 'DRAFT';
      case 'PAID':
        return 'PAID';
      case 'PARTIALLY_PAID':
        return 'PARTIALLY_PAID';
      case 'CANCELLED':
        return 'VOID';
      default:
        return 'SENT'; // SENT, VIEWED, PENDING_PAYMENT all read as "sent" to Zoho
    }
  }

  /**
   * Resolves the brand's Zoho connection for a push. Null means "never
   * connected" — a legitimate no-op the caller already knows how to handle.
   * A thrown error means the brand *is* connected but the OAuth refresh
   * token Zoho gave us no longer works (expired, revoked, app
   * de-authorized) — previously this threw before any SyncJob row existed,
   * so it was invisible everywhere sync health is surfaced (Needs
   * Attention, the integrations panel's health field, the connection's
   * activity log) and simply vanished into the worker process's raw logs.
   * Recording it here, with the same RUNNING→FAILED SyncJob row runJob
   * writes for an in-flight push, closes that gap.
   */
  private async resolveConnection(
    scope: Scope,
    brandId: string,
    objectType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT',
    objectId: string,
  ): Promise<AccountingConnection | null> {
    try {
      return await this.connections.buildAccountingConnection(scope, brandId);
    } catch (error) {
      const job = await this.prisma.withoutScope(
        `recording sync job start for brand ${brandId}`,
        (client) =>
          client.syncJob.create({
            data: {
              brandId,
              provider: 'ZOHO_BOOKS',
              direction: 'PUSH',
              objectType,
              objectId,
              status: 'RUNNING',
              attemptCount: 1,
            },
          }),
      );
      return this.recordFailure(scope, brandId, objectType, objectId, job.id, error);
    }
  }

  /**
   * Shared tail of a failed push, used both when the push's own work throws
   * (runJob) and when resolving the connection itself throws (
   * resolveConnection): records the SyncJob row as FAILED with the
   * classified error, flags the connection unhealthy on an AUTHENTICATION
   * failure so the integrations panel stops reporting "Healthy" underneath
   * a run of failures, and rethrows — as UnrecoverableError for an error
   * class BullMQ's retries can never fix, otherwise the original error so
   * the queue's retry policy (TDD-001 §11.1) still applies. Return type is
   * `never`: every path out of this function throws.
   */
  private async recordFailure(
    scope: Scope,
    brandId: string,
    objectType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT',
    objectId: string,
    jobId: string,
    error: unknown,
  ): Promise<never> {
    const integrationError = error instanceof IntegrationError ? error : null;
    // Guarded for the same reason as below: recording why we failed must
    // never replace the error itself, which the queue's retry policy reads
    // to decide whether to try again.
    try {
      await this.prisma.withoutScope(
        `recording sync job failure for brand ${brandId}`,
        (client) =>
          client.syncJob.update({
            where: { id: jobId },
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
        `could not record push failure for brand ${brandId}: ` +
          `${auditError instanceof Error ? auditError.message : String(auditError)}`,
      );
    }
    this.logger.warn(
      `Zoho push failed — brand ${brandId}, ${objectType} ${objectId}: ${error instanceof Error ? error.message : error}`,
    );

    // A revoked or rejected credential is the one failure an operator has to
    // act on themselves, and it was previously invisible: the panel kept
    // reporting "Healthy" while every job failed behind it. markUnhealthy
    // deliberately leaves `status` alone — see its own comment for why
    // halting here would be worse than surfacing it.
    if (integrationError?.errorClass === 'AUTHENTICATION') {
      try {
        await this.connections.markUnhealthy(
          scope,
          brandId,
          integrationError.providerMessage ?? integrationError.message,
        );
      } catch (healthError) {
        this.logger.warn(
          `could not record unhealthy state for brand ${brandId}: ` +
            `${healthError instanceof Error ? healthError.message : String(healthError)}`,
        );
      }
    }

    // A non-retryable class (e.g. VALIDATION — "this customer already
    // exists") will never succeed no matter how many times BullMQ retries
    // it. UnrecoverableError tells BullMQ to stop immediately instead of
    // consulting attempts/backoff at all.
    if (integrationError && !integrationError.retryable) {
      throw new UnrecoverableError(integrationError.message);
    }
    throw error;
  }

  /**
   * Wraps a push in a SyncJob row (FR-ZHO-020/021): RUNNING, then SUCCEEDED
   * or FAILED with the classified error and Zoho's verbatim message. Rethrown
   * on failure so BullMQ's own retry policy (TDD-001 §11.1) still applies —
   * this row is the audit trail, not a second retry mechanism.
   */
  private async runJob(
    scope: Scope,
    brandId: string,
    objectType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT',
    objectId: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const job = await this.prisma.withoutScope(
      `recording sync job start for brand ${brandId}`,
      (client) =>
        client.syncJob.create({
          data: {
            brandId,
            provider: 'ZOHO_BOOKS',
            direction: 'PUSH',
            objectType,
            objectId,
            status: 'RUNNING',
            attemptCount: 1,
          },
        }),
    );

    try {
      await work();
      // Guarded: the write to Zoho has already landed. Letting the audit write
      // fail the job would have BullMQ retry a push that already succeeded.
      try {
        await this.prisma.withoutScope(
          `recording sync job success for brand ${brandId}`,
          (client) =>
            client.syncJob.update({
              where: { id: job.id },
              data: { status: 'SUCCEEDED', completedAt: new Date() },
            }),
        );
      } catch (auditError) {
        this.logger.warn(
          `push succeeded for brand ${brandId} but its SyncJob row could not be updated: ` +
            `${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }
      // Advances the connection's own lastSyncAt and clears any stale failure
      // reason. Until this call existed, lastSyncAt was written once by
      // saveZohoConnection and never again, so the "last sync" figure on the
      // integrations panel was really just the moment the brand connected.
      //
      // Guarded: the remote write has already happened and the SyncJob is
      // already SUCCEEDED by this point, so letting a failure here escape would
      // report a completed push as failed and have BullMQ retry it. A stale
      // timestamp is a cosmetic problem; a spurious retry is not.
      try {
        await this.connections.recordSyncRun(scope, brandId);
      } catch (bookkeepingError) {
        this.logger.warn(
          `push succeeded for brand ${brandId} but recording lastSyncAt failed: ` +
            `${bookkeepingError instanceof Error ? bookkeepingError.message : bookkeepingError}`,
        );
      }
    } catch (error) {
      await this.recordFailure(scope, brandId, objectType, objectId, job.id, error);
    }
  }
}

export type { IntegrationErrorType };
