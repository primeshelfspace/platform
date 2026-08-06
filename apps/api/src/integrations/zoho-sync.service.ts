import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type {
  AccountingAddress,
  AccountingConnection,
  AccountingCustomer,
  AccountingInvoice,
  AccountingPayment,
  IntegrationError as IntegrationErrorType,
} from '@fenwick/shared';
import { IntegrationError } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';
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
  async enqueueBackfill(brandId: string): Promise<BackfillCounts> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-backfill');
    if (!scope) throw new ConflictException('unknown brand');

    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) throw new ConflictException('brand is not connected to Zoho');

    const [rawPayments, invoices, customers] = await this.prisma.withScope(scope, (tx) =>
      Promise.all([
        tx.payment.findMany({
          where: { brandId, zohoPaymentId: null, status: { in: [...SETTLED_PAYMENT_STATUSES] } },
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
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return;
    if (!opts?.viaCascade) {
      const flags = await this.connections.getSyncFlags(scope, brandId);
      if (flags && !flags.customerSyncEnabled) return;
    }

    await this.runJob(brandId, 'CUSTOMER', customerId, async () => {
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

      const result = await this.zoho.upsertCustomer(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.customer.update({
          where: { id: customer.id },
          data: { zohoContactId: result.remoteId },
        }),
      );
    });
  }

  async pushInvoice(brandId: string, invoiceId: string): Promise<void> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-sync');
    if (!scope) return;
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return;
    const flags = await this.connections.getSyncFlags(scope, brandId);
    if (flags && !flags.invoiceSyncEnabled) return;

    await this.runJob(brandId, 'INVOICE', invoiceId, async () => {
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

      const result = await this.zoho.pushInvoice(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.invoice.update({ where: { id: invoice.id }, data: { zohoInvoiceId: result.remoteId } }),
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
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return;
    const flags = await this.connections.getSyncFlags(scope, brandId);
    if (flags && !flags.invoiceSyncEnabled) return;

    await this.runJob(brandId, 'PAYMENT', paymentId, async () => {
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

      const result = await this.zoho.pushPayment(connection, dto);
      await this.prisma.withScope(scope, (tx) =>
        tx.payment.update({
          where: { id: refreshed.id },
          data: { zohoPaymentId: result.remoteId },
        }),
      );
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
   * Wraps a push in a SyncJob row (FR-ZHO-020/021): RUNNING, then SUCCEEDED
   * or FAILED with the classified error and Zoho's verbatim message. Rethrown
   * on failure so BullMQ's own retry policy (TDD-001 §11.1) still applies —
   * this row is the audit trail, not a second retry mechanism.
   */
  private async runJob(
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
      await this.prisma.withoutScope(`recording sync job success for brand ${brandId}`, (client) =>
        client.syncJob.update({
          where: { id: job.id },
          data: { status: 'SUCCEEDED', completedAt: new Date() },
        }),
      );
    } catch (error) {
      const integrationError = error instanceof IntegrationError ? error : null;
      await this.prisma.withoutScope(`recording sync job failure for brand ${brandId}`, (client) =>
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
        `Zoho push failed — brand ${brandId}, ${objectType} ${objectId}: ${error instanceof Error ? error.message : error}`,
      );

      // A non-retryable class (e.g. VALIDATION — "this customer already
      // exists") will never succeed no matter how many times BullMQ retries
      // it. Without this, the queue's default attempts:5 blindly retries
      // every failure regardless of class, multiplying one permanent
      // failure into five recorded ones. UnrecoverableError tells BullMQ to
      // stop immediately instead of consulting attempts/backoff at all.
      if (integrationError && !integrationError.retryable) {
        throw new UnrecoverableError(integrationError.message);
      }
      throw error;
    }
  }
}

export type { IntegrationErrorType };
