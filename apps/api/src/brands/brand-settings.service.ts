import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  formatMinorForDisplay,
  MAIL_PORT,
  renderEmailReceiptTemplate,
  toCurrencyCode,
  type EmailReceiptSettingsInput,
  type EmailReceiptTestSendInput,
  type MailPort,
  type PaymentMethodSettingsInput,
  type PaymentPageDisplayInput,
  type Scope,
} from '@fenwick/shared';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface PaymentMethodSettings {
  readonly cardEnabled: boolean;
  readonly applePayEnabled: boolean;
  readonly googlePayEnabled: boolean;
  readonly achEnabled: boolean;
  readonly checkEnabled: boolean;
}

export interface PaymentPageDisplaySettings {
  readonly accentColor: string;
  readonly paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
}

export interface EmailReceiptSettings {
  readonly emailReceiptLayout: 'CLASSIC' | 'HERO' | 'MINIMAL';
  readonly emailReceiptSubject: string;
  readonly emailReceiptBody: string;
}

/** Same numbers the admin editor's preview falls back to when a brand has no
 * invoices yet (see PaymentPagePreviewInvoice's SAMPLE_PREVIEW) — a test send
 * must show the same thing the preview promised, not a different fake. */
const SAMPLE_INVOICE = {
  customerName: 'Harborline Distributors',
  number: 'INV-3021',
  amountLabel: '$4,820.00',
  dueDateLabel: 'Aug 26, 2026',
};

/**
 * FR-PAY-005. Deliberately separate from the (currently unused) general
 * BrandSettings CRUD — this is the one slice of it with a real consumer:
 * the public payment page and PaymentsService.createIntent both read this
 * to decide what a brand actually offers.
 */
@Injectable()
export class BrandSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async getPaymentMethods(scope: Scope, brandId: string): Promise<PaymentMethodSettings> {
    const settings = await this.prisma.withScope(scope, (tx) =>
      tx.brandSettings.findUnique({ where: { brandId } }),
    );
    if (!settings) throw new NotFoundException('brand settings not found');
    return {
      cardEnabled: settings.cardEnabled,
      applePayEnabled: settings.applePayEnabled,
      googlePayEnabled: settings.googlePayEnabled,
      achEnabled: settings.achEnabled,
      checkEnabled: settings.checkEnabled,
    };
  }

  async updatePaymentMethods(
    scope: Scope,
    brandId: string,
    input: PaymentMethodSettingsInput,
  ): Promise<PaymentMethodSettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!existing) throw new NotFoundException('brand settings not found');

      // Disabling every method leaves every invoice unpayable with no
      // indication why — refused here rather than discovered by a confused
      // customer on the payment page.
      const anyEnabled =
        input.cardEnabled ||
        input.applePayEnabled ||
        input.googlePayEnabled ||
        input.achEnabled ||
        input.checkEnabled;
      if (!anyEnabled) {
        throw new ConflictException('at least one payment method must stay enabled');
      }

      const updated = await tx.brandSettings.update({ where: { brandId }, data: input });
      return {
        cardEnabled: updated.cardEnabled,
        applePayEnabled: updated.applePayEnabled,
        googlePayEnabled: updated.googlePayEnabled,
        achEnabled: updated.achEnabled,
        checkEnabled: updated.checkEnabled,
      };
    });
  }

  async getPaymentPageDisplay(scope: Scope, brandId: string): Promise<PaymentPageDisplaySettings> {
    const settings = await this.prisma.withScope(scope, (tx) =>
      tx.brandSettings.findUnique({ where: { brandId } }),
    );
    if (!settings) throw new NotFoundException('brand settings not found');
    return { accentColor: settings.accentColor, paymentPageLayout: settings.paymentPageLayout };
  }

  async updatePaymentPageDisplay(
    scope: Scope,
    brandId: string,
    input: PaymentPageDisplayInput,
  ): Promise<PaymentPageDisplaySettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!existing) throw new NotFoundException('brand settings not found');

      const updated = await tx.brandSettings.update({ where: { brandId }, data: input });
      return { accentColor: updated.accentColor, paymentPageLayout: updated.paymentPageLayout };
    });
  }

  async getEmailReceiptSettings(scope: Scope, brandId: string): Promise<EmailReceiptSettings> {
    const settings = await this.prisma.withScope(scope, (tx) =>
      tx.brandSettings.findUnique({ where: { brandId } }),
    );
    if (!settings) throw new NotFoundException('brand settings not found');
    return {
      emailReceiptLayout: settings.emailReceiptLayout,
      emailReceiptSubject: settings.emailReceiptSubject,
      emailReceiptBody: settings.emailReceiptBody,
    };
  }

  async updateEmailReceiptSettings(
    scope: Scope,
    brandId: string,
    input: EmailReceiptSettingsInput,
  ): Promise<EmailReceiptSettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.brandSettings.findUnique({ where: { brandId } });
      if (!existing) throw new NotFoundException('brand settings not found');

      const updated = await tx.brandSettings.update({ where: { brandId }, data: input });
      return {
        emailReceiptLayout: updated.emailReceiptLayout,
        emailReceiptSubject: updated.emailReceiptSubject,
        emailReceiptBody: updated.emailReceiptBody,
      };
    });
  }

  /**
   * Brand Settings > Branding > Email Receipt's "Send a test email" —
   * actually sends, through the same MailPort every other email in this
   * system goes through. Renders `input`'s subject/body rather than the
   * brand's saved settings, so testing a draft never requires saving it
   * first — the editor sends exactly what's on screen. Uses the brand's most
   * recent real invoice for the variables; a brand with no invoices yet gets
   * the same SAMPLE_INVOICE numbers its preview already shows, never a
   * different fake — see PaymentPagePreviewInvoice's SAMPLE_PREVIEW on the
   * admin side.
   */
  async sendEmailReceiptTest(
    scope: Scope,
    brandId: string,
    input: EmailReceiptTestSendInput,
  ): Promise<void> {
    const { brand, invoice } = await this.prisma.withScope(scope, async (tx) => {
      const brandRow = await tx.brand.findFirst({ where: { id: brandId } });
      if (!brandRow) throw new NotFoundException('brand not found');

      const invoiceRow = await tx.invoice.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        include: { customer: true },
      });

      return { brand: brandRow, invoice: invoiceRow };
    });

    const variables = invoice
      ? {
          brandName: brand.displayName,
          customerName: invoice.customer.displayName,
          invoiceNumber: invoice.number,
          amountDue: formatMinorForDisplay(
            Number(invoice.balanceMinor),
            toCurrencyCode(invoice.currency),
          ),
          dueDate: new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).format(invoice.dueDate),
        }
      : {
          brandName: brand.displayName,
          customerName: SAMPLE_INVOICE.customerName,
          invoiceNumber: SAMPLE_INVOICE.number,
          amountDue: SAMPLE_INVOICE.amountLabel,
          dueDate: SAMPLE_INVOICE.dueDateLabel,
        };

    const subject = renderEmailReceiptTemplate(input.emailReceiptSubject, variables);
    const body = renderEmailReceiptTemplate(input.emailReceiptBody, variables);

    await this.mail.send({
      to: [input.to],
      from: parseFrom(this.env.MAIL_FROM),
      subject: `[Test] ${subject}`,
      text: [
        body,
        '',
        `Invoice ${variables.invoiceNumber}`,
        `Amount due: ${variables.amountDue}`,
        `Due date: ${variables.dueDate}`,
        '',
        'This is a test send — no payment is due and this email was not sent to a real customer.',
      ].join('\n'),
      html: renderEmailReceiptHtml({ themeColor: brand.themeColor, body, variables }),
      messageTag: { brandId, templateKey: 'email-receipt.test' },
      // Every click is a deliberate, distinct send — a merchant testing three
      // wording changes in a row expects three emails, not one.
      idempotencyKey: `email-receipt-test:${brandId}:${Date.now()}`,
    });
  }
}

/** `"Prime Shelf Space Inc. <billing@localhost>"` -> name and address. Mirrors
 * AuthMailService's own parseFrom — duplicated rather than shared because a
 * third caller isn't due yet and the two are one line each. */
function parseFrom(value: string): { name: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match?.[1] && match[2]) return { name: match[1].trim(), address: match[2].trim() };
  return { name: 'Prime Shelf Space Inc.', address: value.trim() };
}

function renderEmailReceiptHtml(input: {
  themeColor: string;
  body: string;
  variables: { invoiceNumber: string; amountDue: string; dueDate: string };
}): string {
  const paragraphs = input.body
    .split('\n')
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px;font-size:15px;color:#334155;">${escapeHtml(line)}</p>`
        : '',
    )
    .join('\n');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F8FAFC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${escapeHtml(input.themeColor)};padding:20px 32px;">
        <span style="font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.85);">Test send</span>
      </td></tr>
      <tr><td style="padding:32px;">
        ${paragraphs}
        <a href="#" style="display:inline-block;margin-top:12px;background:#171717;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:15px;font-weight:600;">
          View &amp; Pay Invoice
        </a>
        <table role="presentation" style="width:100%;margin-top:24px;border-top:1px solid #E2E8F0;padding-top:16px;font-size:13px;color:#475569;">
          <tr><td>Invoice number</td><td style="text-align:right;">${escapeHtml(input.variables.invoiceNumber)}</td></tr>
          <tr><td>Amount due</td><td style="text-align:right;">${escapeHtml(input.variables.amountDue)}</td></tr>
          <tr><td>Due date</td><td style="text-align:right;">${escapeHtml(input.variables.dueDate)}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
