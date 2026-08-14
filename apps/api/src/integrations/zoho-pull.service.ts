import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IntegrationError,
  type AccountingConnection,
  type InvoiceStatus,
  type Scope,
} from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
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
  ) {}

  async pullBrand(brandId: string): Promise<PullCounts> {
    const scope = await this.systemScope.forBrand(brandId, 'zoho-pull');
    if (!scope) return { customers: 0, invoices: 0, payments: 0 };
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) return { customers: 0, invoices: 0, payments: 0 };

    const pullStartedAt = new Date();
    const cursor = await this.connections.getLastPulledAt(scope, brandId);

    const customers = await this.pullCustomers(scope, brandId, connection, cursor);
    const invoices = await this.pullInvoices(scope, brandId, connection, cursor);
    const payments = await this.pullPayments(scope, brandId, connection);

    await this.connections.recordPullRun(scope, brandId, pullStartedAt);

    const counts = { customers, invoices, payments };
    this.logger.log(
      `pull complete for brand ${brandId}: ${counts.customers} customers, ${counts.invoices} invoices, ${counts.payments} payments`,
    );
    return counts;
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
        for (const item of contacts) {
          const changedSinceCursor =
            !cursor || !item.last_modified_time || new Date(item.last_modified_time) > cursor;
          if (!changedSinceCursor) continue;
          await this.pullOneCustomer(scope, brandId, connection, item.contact_id);
          touched++;
        }
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

      await this.prisma.withScope(scope, async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { brandId, zohoContactId: contactId },
        });
        if (existing) {
          await tx.customer.update({ where: { id: existing.id }, data });
        } else {
          await tx.customer.create({ data: { ...data, brandId, zohoContactId: contactId } });
        }
      });
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
        for (const item of invoices) {
          await this.pullOneInvoice(scope, brandId, connection, item.invoice_id);
          touched++;
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

      await this.prisma.withScope(scope, async (tx) => {
        const existing = await tx.invoice.findFirst({
          where: { brandId, zohoInvoiceId: invoiceId },
        });
        const row = existing
          ? await tx.invoice.update({ where: { id: existing.id }, data })
          : await tx.invoice.create({
              data: {
                ...data,
                brandId,
                zohoInvoiceId: invoiceId,
                publicToken: this.randomPublicToken(),
                cardFeeRateBpApplied: 0,
                cardFeeMinor: 0n,
              },
            });

        await tx.lineItem.deleteMany({ where: { invoiceId: row.id } });
        await tx.lineItem.createMany({
          data: this.toLocalLineItems(row.id, invoice),
        });
      });
    });
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
        for (const item of payments) {
          const applied = await this.pullOnePayment(scope, brandId, connection, item.payment_id);
          if (applied) touched++;
        }
        hasMore = hasMorePage;
        page++;
      }
      return touched;
    });
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
