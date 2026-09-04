import { randomBytes } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Invoice, type LineItem } from '@prisma/client';
import {
  formatQuantity,
  IntegrationError,
  MAIL_PORT,
  PAYABLE_STATUSES,
  calculate,
  evaluateTransition,
  formatDateForDisplay,
  formatMinorForDisplay,
  isPublicScope,
  parseMinor,
  quantityFrom,
  renderEmailReceiptHtml,
  renderEmailReceiptTemplate,
  renderInvoicePdfHtml,
  STORAGE_PORT,
  toCurrencyCode,
  type EmailReceiptLayout,
  type InvoiceDraftInput,
  type InvoiceListQuery,
  type MailPort,
  type Scope,
  type StoragePort,
} from '@fenwick/shared';
import { formatBrandAddress, parseFrom, toInvoicePdfSettings } from '../brands/brand-settings.service.js';
import { brandLogoAttachment, LOGO_CID } from '../common/logo-upload.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';
import { InvoicePdfService } from '../public/invoice-pdf.service.js';

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
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly invoicePdf: InvoicePdfService,
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
   * PAYMENT_SETTLED, PAYMENT_FAILED, EMAIL_SENT), newest first, same
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
   * What the Invoice Details drawer's Send/Resend compose modal opens with —
   * subject/body already substituted from the brand's Email Receipt
   * template against this real invoice, `to` from the customer's email on
   * file (empty if it has none, rather than throwing — the modal lets a
   * merchant type one in for exactly that case).
   *
   * Also carries the layout/accentColor this brand has saved, so the
   * modal's "Preview Email" can render the same look sendEmail below will
   * actually send — it used to hardcode a single generic layout, which
   * meant a merchant who picked Hero or Minimal in Brand Settings saw
   * Classic in the compose preview and assumed their choice was being
   * ignored, even though the real send already honoured it correctly.
   */
  async prepareEmail(
    scope: Scope,
    brandId: string,
    id: string,
  ): Promise<{
    to: string;
    subject: string;
    body: string;
    layout: EmailReceiptLayout;
    accentColor: string;
  }> {
    const { invoice, settings } = await this.prisma.withScope(scope, async (tx) => {
      const invoiceRow = await tx.invoice.findFirst({
        where: { id, brandId },
        include: { customer: true, brand: true },
      });
      if (!invoiceRow) throw new NotFoundException('invoice not found');

      const settingsRow = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!settingsRow) throw new NotFoundException('brand settings not found');

      return { invoice: invoiceRow, settings: settingsRow };
    });

    const currency = toCurrencyCode(invoice.currency);
    const variables = {
      brandName: invoice.brand.displayName,
      customerName: invoice.customer.displayName,
      invoiceNumber: invoice.number,
      amountDue: formatMinorForDisplay(Number(invoice.balanceMinor), currency),
      dueDate: formatDateForDisplay(invoice.dueDate),
    };
    return {
      to: invoice.customer.email ?? '',
      subject: renderEmailReceiptTemplate(settings.emailReceiptSubject, variables),
      body: renderEmailReceiptTemplate(settings.emailReceiptBody, variables),
      layout: settings.emailReceiptLayout,
      accentColor: settings.accentColor,
    };
  }

  /**
   * The Invoice Details drawer's "Send"/"Resend" — one real send either way,
   * to whatever the compose modal actually shows on screen (see
   * prepareEmail above for how that got pre-filled; the caller may have
   * edited any of it, including typing in an email for a customer with none
   * on file). The recipient and the wording are never re-derived here — the
   * caller already resolved both, and re-deriving them would let this send
   * disagree with what the merchant reviewed before clicking Send.
   *
   * The brand's *appearance* is read here rather than passed in, for the
   * same reason: the compose modal cannot edit layout, colours or logo, so
   * there is nothing on screen for a fresh read to contradict, and reading
   * it at send time is what makes Brand Settings > Branding actually govern
   * the email a customer receives.
   */
  async sendEmail(
    scope: Scope,
    brandId: string,
    id: string,
    input: { to: string; cc?: string; subject: string; body: string; attachPdf?: boolean },
  ): Promise<void> {
    const invoice = await this.prisma.withScope(scope, (tx) =>
      tx.invoice.findFirst({
        where: { id, brandId },
        // customer only so the body can emphasise their name the way the
        // editor's preview does; nothing else here reads it. lineItems is
        // only actually used when input.attachPdf is set, but it's cheap
        // enough to always join rather than branch the query.
        include: {
          customer: true,
          brand: { include: { settings: true } },
          lineItems: { orderBy: { position: 'asc' } },
        },
      }),
    );
    if (!invoice) throw new NotFoundException('invoice not found');

    const branding = invoice.brand.settings;
    // A brand always gets a settings row at creation (see BrandsService), so
    // this is a defensive fallback rather than a real steady state — the
    // schema's own column defaults, restated.
    const layout = branding?.emailReceiptLayout ?? 'CLASSIC';
    const accentColor = branding?.accentColor ?? '#171717';

    // Outside the transaction on purpose — storage is a network call, and
    // withScope holds a real transaction open for the whole callback.
    const logo = await brandLogoAttachment(this.storage, invoice.brand.logoKey);

    const currency = toCurrencyCode(invoice.currency);
    const summary = {
      invoiceNumber: invoice.number,
      amountDue: formatMinorForDisplay(Number(invoice.balanceMinor), currency),
      dueDate: formatDateForDisplay(invoice.dueDate),
      customerName: invoice.customer.displayName,
      brandName: invoice.brand.displayName,
    };
    const linkUrl = `${this.env.PAYMENT_PUBLIC_URL}/i/${invoice.publicToken}`;

    // The "Attach Invoice PDF" checkbox — same renderer and settings the
    // Invoices detail drawer's own Download PDF button uses (invoice-pdf-html.ts
    // via InvoicePdfService), so the attachment always matches what a
    // merchant would get downloading it separately.
    let pdfAttachment: { filename: string; contentType: string; content: Buffer } | undefined;
    if (input.attachPdf) {
      const invoicePdfSettings = branding
        ? toInvoicePdfSettings(branding, invoice.brand)
        : {
            themeColor: invoice.brand.themeColor,
            accentColor,
            invoicePdfLayout: 'CLASSIC' as const,
            showCompanyAddress: true,
            showPaymentTerms: true,
            showTaxBreakdown: true,
            showNotes: true,
            companyName: invoice.brand.displayName,
            companyAddress: formatBrandAddress(invoice.brand.mailingAddress),
            paymentTerms: 'DUE_ON_RECEIPT' as const,
            notes: 'Thank you for your business. Please contact us with any questions.',
          };

      const html = renderInvoicePdfHtml({
        number: invoice.number,
        invoiceDate: formatDateForDisplay(invoice.invoiceDate),
        dueDate: formatDateForDisplay(invoice.dueDate),
        brand: {
          displayName: invoice.brand.displayName,
          themeColor: invoice.brand.themeColor,
          logoUrl: logo ? `cid:${LOGO_CID}` : null,
        },
        customerName: invoice.customer.displayName,
        customerAddress: formatBrandAddress(invoice.customer.billingAddress),
        settings: invoicePdfSettings,
        lines: invoice.lineItems.map((line) => ({
          itemName: line.itemName,
          quantityLabel: formatQuantity(line.quantity),
          rateLabel: formatMinorForDisplay(Number(line.unitPriceMinor), currency),
          amountLabel: formatMinorForDisplay(Number(line.lineTotalMinor), currency),
        })),
        subtotalLabel: formatMinorForDisplay(Number(invoice.subtotalMinor), currency),
        totalLabel: formatMinorForDisplay(Number(invoice.totalMinor), currency),
        balanceDueLabel: formatMinorForDisplay(Number(invoice.balanceMinor), currency),
      });
      const pdf = await this.invoicePdf.render(html);
      pdfAttachment = {
        filename: `invoice-${invoice.number}.pdf`,
        contentType: 'application/pdf',
        content: pdf,
      };
    }

    const attachments = [logo, pdfAttachment].filter((a) => a !== null && a !== undefined);

    try {
      await this.mail.send({
        to: [input.to],
        cc: input.cc ? [input.cc] : undefined,
        from: parseFrom(this.env.MAIL_FROM),
        subject: input.subject,
        text: [
          input.body,
          '',
          `Invoice ${summary.invoiceNumber}`,
          `Amount due: ${summary.amountDue}`,
          `Due date: ${summary.dueDate}`,
          '',
          `View and pay: ${linkUrl}`,
        ].join('\n'),
        html: renderEmailReceiptHtml({
          layout,
          brandName: invoice.brand.displayName,
          themeColor: invoice.brand.themeColor,
          accentColor,
          logoSrc: logo ? `cid:${LOGO_CID}` : null,
          senderAddress: parseFrom(this.env.MAIL_FROM).address,
          subject: input.subject,
          body: input.body,
          variables: summary,
          linkUrl,
        }),
        attachments: attachments.length > 0 ? attachments : undefined,
        messageTag: { brandId, invoiceId: id, templateKey: 'email-receipt.invoice-send' },
        // Every click is a deliberate send — a merchant clicking twice in a
        // row (e.g. after fixing a typo'd address) expects two emails.
        idempotencyKey: `invoice-send:${id}:${Date.now()}`,
      });
    } catch (error) {
      // The adapter's own failure (auth rejected, connection refused, a
      // recipient the provider bounced) must not reach the caller as Nest's
      // generic 500 — that's the one thing a merchant actually needs to see
      // to fix a send. Logged here (brand/invoice/provider context, never
      // SMTP_PASSWORD or any other credential — those never flow into
      // IntegrationError.message/providerMessage in the first place) so a
      // failure is diagnosable from server logs even when the client only
      // gets the safe, generic message below.
      const providerMessage =
        error instanceof IntegrationError ? error.providerMessage : undefined;
      this.logger.error(
        `invoice email send failed — brand ${brandId} invoice ${id}: ${
          providerMessage ?? (error instanceof Error ? error.message : String(error))
        }`,
      );
      throw new BadGatewayException(
        'Could not send this email — the mail server rejected it or could not be reached. ' +
          'Check the SMTP configuration and try again.',
      );
    }

    await this.prisma.withScope(scope, (tx) =>
      tx.invoiceEvent.create({
        data: {
          invoiceId: id,
          eventType: 'EMAIL_SENT',
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
