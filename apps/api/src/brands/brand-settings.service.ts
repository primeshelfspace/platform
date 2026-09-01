import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Brand, type BrandSettings } from '@prisma/client';
import {
  formatDateForDisplay,
  formatMinorForDisplay,
  isPublicScope,
  MAIL_PORT,
  renderEmailReceiptHtml,
  renderEmailReceiptTemplate,
  STORAGE_PORT,
  toCurrencyCode,
  type BrandElementsInput,
  type EmailReceiptLayout,
  type EmailReceiptSettingsInput,
  type EmailReceiptTestSendInput,
  type InvoicePdfSettingsInput,
  type MailPort,
  type PaymentMethodSettingsInput,
  type PaymentPageDisplayInput,
  type Scope,
  type StoragePort,
} from '@fenwick/shared';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type ScopedClient } from '../infra/prisma/prisma.service.js';
import { brandLogoAttachment, LOGO_CID } from '../common/logo-upload.js';

export interface PaymentMethodSettings {
  readonly cardEnabled: boolean;
  readonly applePayEnabled: boolean;
  readonly googlePayEnabled: boolean;
  readonly achEnabled: boolean;
  readonly checkEnabled: boolean;
}

/** The two colours every Branding editor edits together. Part of each
 * section's read and write shape so a client never has to stitch a brand
 * request and a settings request together to render one panel. */
export interface BrandElements {
  readonly themeColor: string;
  readonly accentColor: string;
}

export interface PaymentPageDisplaySettings extends BrandElements {
  readonly paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
}

export interface EmailReceiptSettings extends BrandElements {
  readonly emailReceiptLayout: EmailReceiptLayout;
  readonly emailReceiptSubject: string;
  readonly emailReceiptBody: string;
  /**
   * The address these emails actually arrive from — platform configuration
   * (MAIL_FROM), not a per-brand setting, and read-only here.
   *
   * Returned because the editor's preview shows a sender line, and it used
   * to invent `noreply@<brandname>.com` for it: an address that does not
   * exist, on a domain nobody has verified. A preview that lies about the
   * From line teaches a merchant the wrong thing about their own mail.
   */
  readonly senderAddress: string;
}

export interface InvoicePdfSettings extends BrandElements {
  readonly invoicePdfLayout: 'CLASSIC' | 'MODERN' | 'MINIMAL';
  readonly showCompanyAddress: boolean;
  readonly showPaymentTerms: boolean;
  readonly showTaxBreakdown: boolean;
  readonly showNotes: boolean;
  /** Resolved, never null — falls back to the brand's own
   * displayName/mailingAddress until a merchant overrides it. */
  readonly companyName: string;
  readonly companyAddress: string;
  readonly paymentTerms: 'DUE_ON_RECEIPT' | 'NET_15' | 'NET_30' | 'NET_60';
  readonly notes: string;
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
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async getPaymentMethods(scope: Scope, brandId: string): Promise<PaymentMethodSettings> {
    const { settings } = await this.prisma.withScope(scope, (tx) => load(tx, brandId));
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
      const { brand, settings } = await load(tx, brandId);

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
      await this.record(tx, scope, brandId, 'BRAND_PAYMENT_METHODS_UPDATED', settings, brand, {
        brand,
        settings: updated,
      });
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
    const { brand, settings } = await this.prisma.withScope(scope, (tx) => load(tx, brandId));
    return {
      ...elementsOf(brand, settings),
      paymentPageLayout: settings.paymentPageLayout,
    };
  }

  async updatePaymentPageDisplay(
    scope: Scope,
    brandId: string,
    input: PaymentPageDisplayInput,
  ): Promise<PaymentPageDisplaySettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const { brand, settings } = await load(tx, brandId);

      const updated = await writeBranding(tx, brand, settings, input, {
        accentColor: input.accentColor,
        paymentPageLayout: input.paymentPageLayout,
      });

      await this.record(tx, scope, brandId, 'BRAND_PAYMENT_PAGE_UPDATED', settings, brand, updated);
      return {
        ...elementsOf(updated.brand, updated.settings),
        paymentPageLayout: updated.settings.paymentPageLayout,
      };
    });
  }

  async getEmailReceiptSettings(scope: Scope, brandId: string): Promise<EmailReceiptSettings> {
    const { brand, settings } = await this.prisma.withScope(scope, (tx) => load(tx, brandId));
    return this.toEmailReceiptSettings(brand, settings);
  }

  async updateEmailReceiptSettings(
    scope: Scope,
    brandId: string,
    input: EmailReceiptSettingsInput,
  ): Promise<EmailReceiptSettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const { brand, settings } = await load(tx, brandId);

      const updated = await writeBranding(tx, brand, settings, input, {
        accentColor: input.accentColor,
        emailReceiptLayout: input.emailReceiptLayout,
        emailReceiptSubject: input.emailReceiptSubject,
        emailReceiptBody: input.emailReceiptBody,
      });

      await this.record(
        tx,
        scope,
        brandId,
        'BRAND_EMAIL_RECEIPT_UPDATED',
        settings,
        brand,
        updated,
      );
      return this.toEmailReceiptSettings(updated.brand, updated.settings);
    });
  }

  /** Needs `this` for the configured sender address, so it is a method here
   * rather than a module function like toInvoicePdfSettings. */
  private toEmailReceiptSettings(brand: Brand, settings: BrandSettings): EmailReceiptSettings {
    return {
      ...elementsOf(brand, settings),
      emailReceiptLayout: settings.emailReceiptLayout,
      emailReceiptSubject: settings.emailReceiptSubject,
      emailReceiptBody: settings.emailReceiptBody,
      senderAddress: parseFrom(this.env.MAIL_FROM).address,
    };
  }

  async getInvoicePdfSettings(scope: Scope, brandId: string): Promise<InvoicePdfSettings> {
    const { brand, settings } = await this.prisma.withScope(scope, (tx) => load(tx, brandId));
    return toInvoicePdfSettings(settings, brand);
  }

  async updateInvoicePdfSettings(
    scope: Scope,
    brandId: string,
    input: InvoicePdfSettingsInput,
  ): Promise<InvoicePdfSettings> {
    return this.prisma.withScope(scope, async (tx) => {
      const { brand, settings } = await load(tx, brandId);

      const updated = await writeBranding(tx, brand, settings, input, {
        accentColor: input.accentColor,
        invoicePdfLayout: input.invoicePdfLayout,
        invoicePdfShowCompanyAddress: input.showCompanyAddress,
        invoicePdfShowPaymentTerms: input.showPaymentTerms,
        invoicePdfShowTaxBreakdown: input.showTaxBreakdown,
        invoicePdfShowNotes: input.showNotes,
        // A plain nullable String column, not Json — an explicit `null`
        // here already means "clear the override", no Prisma.DbNull dance
        // needed (that's only for Json columns; see BrandsService.update).
        invoicePdfCompanyName: input.companyName,
        invoicePdfCompanyAddress: input.companyAddress,
        invoicePdfPaymentTerms: input.paymentTerms,
        invoicePdfNotes: input.notes,
      });

      await this.record(tx, scope, brandId, 'BRAND_INVOICE_PDF_UPDATED', settings, brand, updated);
      return toInvoicePdfSettings(updated.settings, updated.brand);
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
          dueDate: formatDateForDisplay(invoice.dueDate),
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

    // Read outside the transaction above deliberately — storage is a network
    // call, and withScope holds a real transaction open for its callback.
    const logo = await brandLogoAttachment(this.storage, brand.logoKey);

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
      html: renderEmailReceiptHtml({
        // The draft on screen, not the saved row — the whole point of a test
        // send is seeing an unsaved change land in a real inbox.
        layout: input.emailReceiptLayout,
        brandName: brand.displayName,
        themeColor: input.themeColor,
        accentColor: input.accentColor,
        logoSrc: logo ? `cid:${LOGO_CID}` : null,
        subject,
        body,
        variables,
        linkUrl: '#',
        badgeLabel: 'Test send',
      }),
      attachments: logo ? [logo] : undefined,
      messageTag: { brandId, templateKey: 'email-receipt.test' },
      // Every click is a deliberate, distinct send — a merchant testing three
      // wording changes in a row expects three emails, not one.
      idempotencyKey: `email-receipt-test:${brandId}:${Date.now()}`,
    });
  }

  /**
   * Writes the audit entry for a Branding change, in the same transaction as
   * the change itself — so the log can never claim an edit that rolled back,
   * nor miss one that committed. audit_log has no UPDATE or DELETE grant
   * (see the rls_and_grants migration), which is what makes it evidence.
   *
   * The public payment scope never reaches these endpoints — they are all
   * behind RequirePermission('BRAND_CONFIGURATION') — but it is still a
   * valid Scope at the type level, so it is recorded as a system actor
   * rather than asserted away.
   */
  private async record(
    tx: ScopedClient,
    scope: Scope,
    brandId: string,
    action: string,
    beforeSettings: BrandSettings,
    beforeBrand: Brand,
    after: { brand: Brand; settings: BrandSettings },
  ): Promise<void> {
    const changes = {
      ...diffOf(beforeSettings, after.settings),
      ...diffOf({ themeColor: beforeBrand.themeColor }, { themeColor: after.brand.themeColor }),
    };

    await tx.auditLog.create({
      data: {
        merchantId: scope.merchantId,
        brandId,
        actorType: isPublicScope(scope) ? 'SYSTEM' : 'USER',
        actorId: isPublicScope(scope) ? null : scope.userId,
        action,
        objectType: 'BRAND_SETTINGS',
        objectId: brandId,
        sourceIp: scope.sourceIp,
        outcome: 'SUCCESS',
        metadata: { changes },
      },
    });
  }
}

/**
 * Loads the brand and its settings row together, inside whatever scoped
 * transaction the caller already opened. Every Branding read and write goes
 * through this so all of them 404 identically on a brand the scope cannot
 * reach — under RLS an out-of-scope brand reads as absent, and a bare
 * `update` would surface that as a Prisma P2025 (a 500) instead.
 */
async function load(
  tx: ScopedClient,
  brandId: string,
): Promise<{ brand: Brand; settings: BrandSettings }> {
  const brand = await tx.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new NotFoundException('brand not found');
  const settings = await tx.brandSettings.findUnique({ where: { brandId } });
  if (!settings) throw new NotFoundException('brand settings not found');
  return { brand, settings };
}

/** The Brand Elements panel's two colours, read off the two rows they
 * actually live on. */
function elementsOf(brand: Brand, settings: BrandSettings): BrandElements {
  return { themeColor: brand.themeColor, accentColor: settings.accentColor };
}

/**
 * The single write behind every Branding save: the brand's themeColor and
 * the section's own columns, committed together or not at all.
 *
 * themeColor is written only when it actually differs — a merchant saving an
 * email template should not bump the brand row's updatedAt, and Brand
 * Details' own "last changed" reading stays honest.
 */
async function writeBranding(
  tx: ScopedClient,
  brand: Brand,
  settings: BrandSettings,
  elements: BrandElementsInput,
  data: Prisma.BrandSettingsUncheckedUpdateInput,
): Promise<{ brand: Brand; settings: BrandSettings }> {
  const nextBrand =
    elements.themeColor === brand.themeColor
      ? brand
      : await tx.brand.update({
          where: { id: brand.id },
          data: { themeColor: elements.themeColor },
        });

  const nextSettings = await tx.brandSettings.update({
    where: { brandId: settings.brandId },
    data,
  });

  return { brand: nextBrand, settings: nextSettings };
}

/** Columns that say when a row changed, not what it says — noise in a diff
 * of what a merchant actually edited. */
const NON_CONTENT_COLUMNS = new Set(['createdAt', 'updatedAt', 'brandId', 'nextSequence']);

/** Long free text (an email body runs to 5000 characters) is recorded as
 * having changed rather than copied into the audit row twice — the log is
 * append-only and unbounded, and "the body changed" is the fact worth
 * keeping. */
const MAX_AUDITED_VALUE_LENGTH = 200;

function auditable(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value);
  return text.length > MAX_AUDITED_VALUE_LENGTH ? '<changed>' : text;
}

/** Field-level before/after for the columns this save actually moved. An
 * empty object means the merchant pressed Save without changing anything,
 * which is still worth recording as an access. */
function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: Prisma.InputJsonValue; to: Prisma.InputJsonValue }> {
  const changes: Record<string, { from: Prisma.InputJsonValue; to: Prisma.InputJsonValue }> = {};
  for (const [key, next] of Object.entries(after)) {
    if (NON_CONTENT_COLUMNS.has(key)) continue;
    const previous = before[key];
    if (previous instanceof Date || next instanceof Date) continue;
    if (previous === next) continue;
    changes[key] = { from: auditable(previous), to: auditable(next) };
  }
  return changes;
}

/** Resolves the stored override columns against the brand's own record —
 * the one place that fallback decision gets made, so get and update always
 * agree on what "unset" resolves to. */
/** Exported for PublicInvoicesService — the public invoice page renders per
 * these same resolved settings, and must resolve "unset" exactly the way
 * this does rather than re-deriving its own notion of the fallback. */
export function toInvoicePdfSettings(settings: BrandSettings, brand: Brand): InvoicePdfSettings {
  return {
    ...elementsOf(brand, settings),
    invoicePdfLayout: settings.invoicePdfLayout,
    showCompanyAddress: settings.invoicePdfShowCompanyAddress,
    showPaymentTerms: settings.invoicePdfShowPaymentTerms,
    showTaxBreakdown: settings.invoicePdfShowTaxBreakdown,
    showNotes: settings.invoicePdfShowNotes,
    companyName: settings.invoicePdfCompanyName ?? brand.displayName,
    companyAddress: settings.invoicePdfCompanyAddress ?? formatBrandAddress(brand.mailingAddress),
    paymentTerms: settings.invoicePdfPaymentTerms,
    notes: settings.invoicePdfNotes,
  };
}

/** Brand.mailingAddress is a loosely-typed Json column (see BrandsService) —
 * this reads it defensively rather than assuming the CustomerAddress shape
 * always holds, since nothing enforces that at the database level. Exported
 * for PublicInvoicesService, which formats a customer's billing address the
 * same defensive way (Customer.billingAddress is the identical loose Json
 * shape) rather than a second copy of this. */
export function formatBrandAddress(address: Prisma.JsonValue): string {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return '';
  const a = address as Record<string, unknown>;
  const str = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string) : '');

  const line1 = [str('line1'), str('line2')].filter(Boolean).join(', ');
  const cityLine = [[str('city'), str('region')].filter(Boolean).join(', '), str('postalCode')]
    .filter(Boolean)
    .join(' ');
  return [line1, cityLine].filter(Boolean).join('\n');
}

/** `"Prime Shelf Space Inc. <billing@localhost>"` -> name and address. Mirrors
 * AuthMailService's own parseFrom — duplicated rather than shared because a
 * third caller isn't due yet and the two are one line each. Exported for
 * InvoicesService's resend, which sends through this same MAIL_FROM. */
export function parseFrom(value: string): { name: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match?.[1] && match[2]) return { name: match[1].trim(), address: match[2].trim() };
  return { name: 'Prime Shelf Space Inc.', address: value.trim() };
}
