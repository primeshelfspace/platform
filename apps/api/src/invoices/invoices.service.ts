import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Invoice, type LineItem } from '@prisma/client';
import {
  MAIL_PORT,
  PAYABLE_STATUSES,
  calculate,
  evaluateTransition,
  formatDateForDisplay,
  formatMinorForDisplay,
  isPublicScope,
  parseMinor,
  quantityFrom,
  renderEmailReceiptTemplate,
  toCurrencyCode,
  type InvoiceDraftInput,
  type InvoiceListQuery,
  type MailPort,
  type Scope,
} from '@fenwick/shared';
import { formatBrandAddress, parseFrom, renderEmailReceiptHtml } from '../brands/brand-settings.service.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';

export type InvoiceWithLines = Invoice & { lineItems: LineItem[] };

/** A listing row — InvoiceWithLines plus the customer name the invoices
 * table shows that a single invoice fetch has no need for. */
export type InvoiceListRow = InvoiceWithLines & { customer: { displayName: string } };

/** What the Invoice Details screen needs beyond InvoiceWithLines — the
 * customer identity for its own "Bill To" block, which the list row above
 * only carries a name for. */
export type InvoiceDetail = InvoiceWithLines & {
  customer: { displayName: string; email: string | null; billingAddress: string };
};

export interface InvoiceListResult {
  readonly data: InvoiceListRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface InvoiceSummary {
  readonly outstandingMinor: number;
  readonly openCount: number;
}

/** One row of the Invoice Details "Activity" tab — InvoiceEvent verbatim,
 * not reinterpreted; the timeline is exactly what actually happened. */
export interface InvoiceActivityEntry {
  readonly eventType: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actor: string;
  readonly occurredAt: Date;
}

/**
 * FR-INV. Draft creation and issue only — edit, cancel and duplicate follow
 * once this slice is proven end to end. CalculationService (TDD-001 §9.4) is
 * the only place the totals are computed; this service never re-derives them.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Paginated, matching CustomersService.list — `invoiceListQuerySchema` has
   * existed in packages/shared since the first cut but nothing passed it here,
   * so this loaded every invoice a brand has ever issued, each with all of its
   * line items eagerly joined, on every dashboard and list render.
   */
  async list(scope: Scope, brandId: string, query: InvoiceListQuery): Promise<InvoiceListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where: Prisma.InvoiceWhereInput = { brandId };
      if (query.customerId) where.customerId = query.customerId;
      if (query.status?.length) where.status = { in: query.status };
      if (query.overdueOnly) where.overdue = true;
      if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
      if (query.dateRange && (query.dateRange.from || query.dateRange.to)) {
        where.invoiceDate = {
          ...(query.dateRange.from ? { gte: query.dateRange.from } : {}),
          ...(query.dateRange.to ? { lte: query.dateRange.to } : {}),
        };
      }

      const [data, total] = await Promise.all([
        tx.invoice.findMany({
          where,
          include: {
            lineItems: { orderBy: { position: 'asc' } },
            customer: { select: { displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.invoice.count({ where }),
      ]);

      return { data, page: query.page, pageSize: query.pageSize, total };
    });
  }

  /**
   * The outstanding-balance figure, aggregated in the database.
   *
   * Exists because the dashboard used to fetch every invoice and sum the open
   * ones in JavaScript — which paginating the list above would have silently
   * turned into "the total of whatever happened to be on page one". A SUM
   * belongs in SQL regardless; this just makes that explicit.
   */
  async summary(scope: Scope, brandId: string): Promise<InvoiceSummary> {
    return this.prisma.withScope(scope, async (tx) => {
      const where: Prisma.InvoiceWhereInput = {
        brandId,
        status: { in: [...PAYABLE_STATUSES] },
      };
      const [aggregate, openCount] = await Promise.all([
        tx.invoice.aggregate({ where, _sum: { balanceMinor: true } }),
        tx.invoice.count({ where }),
      ]);
      return {
        outstandingMinor: Number(aggregate._sum.balanceMinor ?? 0n),
        openCount,
      };
    });
  }

  /** The Invoice Details screen's own fetch — InvoiceWithLines plus the
   * customer identity its "Bill To" block needs (see InvoiceDetail). */
  async findOne(scope: Scope, brandId: string, id: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.withScope(scope, (tx) =>
      tx.invoice.findFirst({
        where: { id, brandId },
        include: {
          lineItems: { orderBy: { position: 'asc' } },
          customer: { select: { displayName: true, email: true, billingAddress: true } },
        },
      }),
    );
    if (!invoice) throw new NotFoundException('invoice not found');
    return {
      ...invoice,
      customer: {
        displayName: invoice.customer.displayName,
        email: invoice.customer.email,
        billingAddress: formatBrandAddress(invoice.customer.billingAddress),
      },
    };
  }

  /** The Invoice Details screen's "Activity" tab — every lifecycle event
   * this exact invoice has actually gone through (ISSUE, FIRST_VIEW,
   * PAYMENT_SETTLED, PAYMENT_FAILED, EMAIL_RESENT), newest first, same
   * convention as ZohoConnectController's own activity log. */
  async getActivity(scope: Scope, brandId: string, id: string): Promise<InvoiceActivityEntry[]> {
    const invoice = await this.prisma.withScope(scope, (tx) =>
      tx.invoice.findFirst({ where: { id, brandId }, select: { id: true } }),
    );
    if (!invoice) throw new NotFoundException('invoice not found');

    const events = await this.prisma.withScope(scope, (tx) =>
      tx.invoiceEvent.findMany({
        where: { invoiceId: id },
        orderBy: { occurredAt: 'desc' },
      }),
    );
    return events.map((e) => ({
      eventType: e.eventType,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: e.actor,
      occurredAt: e.occurredAt,
    }));
  }

  /**
   * "Resend" on the Invoice Details screen — a real send to the customer's
   * actual email, through the same Brand Settings > Branding > Email Receipt
   * template and mail path sendEmailReceiptTest already exercises (renderEmailReceiptHtml,
   * parseFrom — both exported from BrandSettingsService for exactly this
   * reuse), except addressed to this real customer with a real, working
   * "View & Pay Invoice" link rather than a placeholder.
   */
  async resendEmail(scope: Scope, brandId: string, id: string): Promise<void> {
    const { invoice, settings, customerEmail } = await this.prisma.withScope(scope, async (tx) => {
      const invoiceRow = await tx.invoice.findFirst({
        where: { id, brandId },
        include: { customer: true, brand: true },
      });
      if (!invoiceRow) throw new NotFoundException('invoice not found');
      if (!invoiceRow.customer.email) {
        throw new ConflictException('this customer has no email on file');
      }

      const settingsRow = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!settingsRow) throw new NotFoundException('brand settings not found');

      return { invoice: invoiceRow, settings: settingsRow, customerEmail: invoiceRow.customer.email };
    });

    const currency = toCurrencyCode(invoice.currency);
    const variables = {
      brandName: invoice.brand.displayName,
      customerName: invoice.customer.displayName,
      invoiceNumber: invoice.number,
      amountDue: formatMinorForDisplay(Number(invoice.balanceMinor), currency),
      dueDate: formatDateForDisplay(invoice.dueDate),
    };
    const subject = renderEmailReceiptTemplate(settings.emailReceiptSubject, variables);
    const body = renderEmailReceiptTemplate(settings.emailReceiptBody, variables);
    const linkUrl = `${this.env.PAYMENT_PUBLIC_URL}/i/${invoice.publicToken}`;

    await this.mail.send({
      to: [customerEmail],
      from: parseFrom(this.env.MAIL_FROM),
      subject,
      text: [
        body,
        '',
        `Invoice ${variables.invoiceNumber}`,
        `Amount due: ${variables.amountDue}`,
        `Due date: ${variables.dueDate}`,
        '',
        `View and pay: ${linkUrl}`,
      ].join('\n'),
      html: renderEmailReceiptHtml({
        themeColor: invoice.brand.themeColor,
        body,
        variables,
        linkUrl,
        badgeLabel: invoice.brand.displayName,
      }),
      messageTag: { brandId, invoiceId: id, templateKey: 'email-receipt.resend' },
      // Every click is a deliberate resend — a merchant clicking twice in a
      // row (e.g. after fixing a bounced address) expects two emails.
      idempotencyKey: `invoice-resend:${id}:${Date.now()}`,
    });

    await this.prisma.withScope(scope, (tx) =>
      tx.invoiceEvent.create({
        data: {
          invoiceId: id,
          eventType: 'EMAIL_RESENT',
          actor: isPublicScope(scope) ? 'system' : scope.userId,
        },
      }),
    );
  }

  /**
   * Draft only. Rates and totals are computed once, here, with
   * paymentMethod: 'MANUAL' — the fee-exempt baseline that becomes "the
   * amount due" everywhere the invoice is shown before a payment method is
   * chosen (open question Q-01, FRS-001 §28.3). A card or wallet payment
   * quotes its own fee-inclusive total at payment time; see PublicInvoicesService.
   */
  async create(scope: Scope, brandId: string, input: InvoiceDraftInput): Promise<InvoiceWithLines> {
    return this.prisma.withScope(scope, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, brandId } });
      if (!customer) throw new NotFoundException('customer not found for this brand');

      const calcLines = input.lines.map((line) => ({
        quantity: quantityFrom(line.quantity),
        unitPriceMinor: parseMinor(line.unitPrice, input.currency),
        taxExempt: line.taxExempt,
      }));

      const result = calculate({
        lines: calcLines,
        taxRateBp: input.taxRateBp,
        cardFeeRateBp: input.cardFeeRateBp,
        paymentMethod: 'MANUAL',
      });

      // Allocates the number under the brand_settings row lock: concurrent
      // creates for the same brand serialise on this UPDATE, which is what
      // keeps the sequence unique without a separate locking construct
      // (NFR-INT-014).
      const settings = await tx.brandSettings.update({
        where: { brandId },
        data: { nextSequence: { increment: 1 } },
        select: { invoicePrefix: true, nextSequence: true },
      });
      const number = `${settings.invoicePrefix}-${String(settings.nextSequence - 1).padStart(4, '0')}`;

      try {
        return await tx.invoice.create({
          data: {
            brandId,
            customerId: input.customerId,
            number,
            status: 'DRAFT',
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate,
            currency: input.currency,
            subtotalMinor: result.subtotalMinor,
            taxRateBpApplied: result.taxRateBpApplied,
            taxMinor: result.taxMinor,
            cardFeeRateBpApplied: result.cardFeeRateBpApplied,
            cardFeeMinor: 0,
            totalMinor: result.totalMinor,
            balanceMinor: result.totalMinor,
            publicToken: randomBytes(16).toString('hex'),
            notes: input.notes,
            internalNotes: input.internalNotes,
            // Zipped by index rather than a second lookup keyed by position:
            // result.lines and input.lines are guaranteed the same length and
            // order as calcLines (calculate() runs the identical .map over
            // these same lines), so an out-of-range read here would mean
            // calculate()'s own contract broke — worth a hard failure, not a
            // silently substituted default.
            lineItems: {
              create: calcLines.map((line, position) => {
                const source = input.lines[position];
                const computed = result.lines[position];
                if (!source || !computed) {
                  throw new Error(
                    `line ${position} missing after calculation — calculate() invariant violated`,
                  );
                }
                return {
                  position,
                  itemName: source.itemName,
                  description: source.description,
                  quantity: line.quantity,
                  unitPriceMinor: line.unitPriceMinor,
                  lineTotalMinor: computed.lineTotalMinor,
                  taxExempt: line.taxExempt,
                };
              }),
            },
          },
          include: { lineItems: { orderBy: { position: 'asc' } } },
        });
      } catch (error) {
        // The sequence lock above should make this unreachable; caught anyway
        // rather than asserting the exact constraint name Prisma generates.
        if (PrismaService.isUniqueViolation(error)) {
          throw new ConflictException('invoice number collision — retry');
        }
        throw error;
      }
    });
  }

  /** FR-INV-014: Draft → Sent. Financial fields become immutable from here. */
  async issue(scope: Scope, brandId: string, id: string): Promise<InvoiceWithLines> {
    const updated = await this.prisma.withScope(scope, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, brandId },
        include: { lineItems: true, customer: true },
      });
      if (!invoice) throw new NotFoundException('invoice not found');

      const decision = evaluateTransition('ISSUE', {
        status: invoice.status,
        lineItemCount: invoice.lineItems.length,
        totalMinor: Number(invoice.totalMinor),
        balanceMinor: Number(invoice.balanceMinor),
        settledMinor: 0,
        customerHasDeliverableEmail: Boolean(invoice.customer.email),
      });
      if (!decision.ok) throw new ConflictException(decision.message);

      const updated = await tx.invoice.update({
        where: { id },
        data: { status: decision.to, issuedAt: new Date() },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });

      await tx.invoiceEvent.create({
        data: {
          invoiceId: id,
          eventType: 'ISSUE',
          fromStatus: invoice.status,
          toStatus: decision.to,
          actor: isPublicScope(scope) ? 'system' : scope.userId,
        },
      });

      return updated;
    });

    // Enqueued after commit — see CustomersService.create for why.
    await this.queue.enqueue('sync', 'zoho-push-invoice', { brandId, invoiceId: id });

    return updated;
  }
}
