import { Inject, Injectable } from '@nestjs/common';
import {
  evaluateTransition,
  formatQuantity,
  STORAGE_PORT,
  type PublicScope,
  type StoragePort,
} from '@fenwick/shared';
import {
  formatBrandAddress,
  toInvoicePdfSettings,
  type InvoicePdfSettings,
} from '../brands/brand-settings.service.js';
import { LOGO_URL_TTL_SECONDS } from '../common/logo-upload.js';
import { StripeAccountService } from '../integrations/stripe-account.service.js';
import { ZohoPullService } from '../integrations/zoho-pull.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface PublicInvoiceView {
  number: string;
  status: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  totalMinor: number;
  balanceMinor: number;
  brand: { displayName: string; themeColor: string; logoUrl: string | null };
  /** Brand Settings > Branding > Payment Page — how this brand's hosted
   * payment page arranges itself and colours its actionable elements. Same
   * settings the admin's Payment Page editor previews; this is what actually
   * renders it for a real customer. */
  accentColor: string;
  paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
  /** Who the invoice is billed to — the "Bill To" block, same identity the
   * admin's own Invoice PDF preview and this brand's issued PDF show. */
  customerName: string;
  /** Multi-line (newline-separated), possibly empty when the customer has
   * no billing address on file — same convention as the admin's own
   * formatAddressLines. */
  customerAddress: string;
  /** Brand Settings > Branding > Invoice PDF — the same settings the admin's
   * Invoice PDF editor previews, applied here so a customer's public invoice
   * page actually reflects the document layout/fields/notes a merchant
   * configured, not a fixed generic summary. */
  invoicePdf: InvoicePdfSettings;
  lines: Array<{
    itemName: string;
    description: string | null;
    quantity: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  subtotalMinor: number;
  taxMinor: number;
  cardFeeRateBp: number;
  partialPaymentEnabled: boolean;
  /** FR-PAY-005 — which methods this brand actually offers. The payment page
   * must only render these; PaymentsService.createIntent enforces the same
   * list server-side regardless of what the client shows. */
  enabledMethods: {
    card: boolean;
    applePay: boolean;
    googlePay: boolean;
    ach: boolean;
    check: boolean;
  };
  /** The PLATFORM's publishable key — under Connect the browser loads Stripe.js
   * with this plus the connected account below, rather than with a key belonging
   * to the brand. Null if this deployment has no Stripe configured. */
  stripePublishableKey: string | null;
  /** The brand's connected account (acct_…), passed to Stripe.js so Elements
   * confirms against the right account. Null if this brand has not completed
   * the Connect flow; the card option should not be offered in that case even
   * if cardEnabled is on. */
  stripeAccountId: string | null;
}

/**
 * Token → data, for the anonymous payment path (TDD-001 §12.1). The token
 * lookup is deliberately unscoped: which brand this belongs to is exactly
 * what it exists to discover, and public_token is a 128-bit random value —
 * possessing it is the only credential required (NFR-SEC-014).
 */
@Injectable()
export class PublicInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeAccounts: StripeAccountService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly zohoPull: ZohoPullService,
  ) {}

  /** Null covers both "no such token" and "deactivated" — deliberately
   * indistinguishable to the caller (TDD-001 §12.1 step 3). */
  async resolveScope(token: string): Promise<PublicScope | null> {
    const invoice = await this.prisma.withoutScope(
      'public token resolution — token possession is the credential (NFR-SEC-014)',
      (client) =>
        client.invoice.findUnique({
          where: { publicToken: token },
          select: {
            id: true,
            brandId: true,
            publicTokenActive: true,
            brand: { select: { merchantId: true } },
          },
        }),
    );
    if (!invoice || !invoice.publicTokenActive) return null;

    return {
      kind: 'PUBLIC',
      merchantId: invoice.brand.merchantId,
      brandId: invoice.brandId,
      invoiceId: invoice.id,
      sourceIp: null,
    };
  }

  async view(scope: PublicScope): Promise<PublicInvoiceView | null> {
    return this.prisma.withScope(scope, async (tx) => {
      const loadInvoice = () =>
        tx.invoice.findFirst({
          where: { id: scope.invoiceId },
          include: {
            lineItems: { orderBy: { position: 'asc' } },
            brand: { include: { settings: true } },
            customer: { select: { displayName: true, billingAddress: true } },
          },
        });

      let invoice = await loadInvoice();
      if (!invoice) return null;

      // Line items aren't part of the list-only Zoho pull (ZohoPullService's
      // own doc comment) — fetched here, on demand, the first time a
      // customer actually opens this invoice's payment page, same as
      // InvoicesService.findOne's admin equivalent. Non-fatal: a failed
      // enrichment (rate limit, revoked token, ...) still shows the invoice
      // with whatever it already has, rather than failing the whole page.
      if (invoice.zohoInvoiceId && invoice.lineItems.length === 0) {
        const enriched = await this.zohoPull
          .enrichInvoiceFromZohoOnDemand(scope, scope.brandId, invoice.id)
          .catch(() => false);
        if (enriched) {
          invoice = (await loadInvoice()) ?? invoice;
        }
      }

      // FIRST_VIEW fires once; the guard only allows it from SENT, so a
      // second retrieval is a no-op (TDD-001 §8.2).
      let effectiveStatus = invoice.status;
      if (invoice.status === 'SENT') {
        const decision = evaluateTransition('FIRST_VIEW', {
          status: 'SENT',
          lineItemCount: invoice.lineItems.length,
          totalMinor: Number(invoice.totalMinor),
          balanceMinor: Number(invoice.balanceMinor),
          settledMinor: 0,
          customerHasDeliverableEmail: true,
        });
        if (decision.ok) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: decision.to, firstViewedAt: new Date() },
          });
          await tx.invoiceEvent.create({
            data: {
              invoiceId: invoice.id,
              eventType: 'FIRST_VIEW',
              fromStatus: 'SENT',
              toStatus: decision.to,
              actor: 'system',
            },
          });
          effectiveStatus = decision.to;
        }
      }

      // Signed per request rather than stored: bucket objects are private and
      // the URL is short-lived. The page is server-rendered on every visit, so
      // a fresh one is always in hand — nothing cached can go stale.
      const logoUrl = invoice.brand.logoKey
        ? await this.storage
            .getSignedUrl(invoice.brand.logoKey, { expiresInSeconds: LOGO_URL_TTL_SECONDS })
            // A missing or unreadable object must not take down the payment
            // page: the customer still needs to pay, branded or not.
            .catch(() => null)
        : null;

      const stripeAccountId = await this.stripeAccounts.getAccountIdForBrand(invoice.brandId);
      const stripePublishableKey = this.stripeAccounts.platformPublishableKey();

      // A brand always gets a settings row at creation (see BrandsService) —
      // this null-handling is the same defensive fallback the fields below
      // already used before invoicePdf existed, not a real steady state.
      const invoicePdf: InvoicePdfSettings = invoice.brand.settings
        ? toInvoicePdfSettings(invoice.brand.settings, invoice.brand)
        : {
            themeColor: invoice.brand.themeColor,
            accentColor: '#171717',
            invoicePdfLayout: 'CLASSIC',
            showCompanyAddress: true,
            showPaymentTerms: true,
            showTaxBreakdown: true,
            showNotes: true,
            companyName: invoice.brand.displayName,
            companyAddress: formatBrandAddress(invoice.brand.mailingAddress),
            paymentTerms: 'DUE_ON_RECEIPT',
            notes: 'Thank you for your business. Please contact us with any questions.',
          };

      return {
        number: invoice.number,
        status: effectiveStatus,
        currency: invoice.currency,
        invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        totalMinor: Number(invoice.totalMinor),
        balanceMinor: Number(invoice.balanceMinor),
        brand: {
          displayName: invoice.brand.displayName,
          themeColor: invoice.brand.themeColor,
          logoUrl,
        },
        accentColor: invoice.brand.settings?.accentColor ?? '#171717',
        paymentPageLayout: invoice.brand.settings?.paymentPageLayout ?? 'BANNER',
        customerName: invoice.customer.displayName,
        customerAddress: formatBrandAddress(invoice.customer.billingAddress),
        invoicePdf,
        lines: invoice.lineItems.map((l) => ({
          itemName: l.itemName,
          description: l.description,
          quantity: formatQuantity(l.quantity),
          unitPriceMinor: Number(l.unitPriceMinor),
          lineTotalMinor: Number(l.lineTotalMinor),
        })),
        subtotalMinor: Number(invoice.subtotalMinor),
        taxMinor: Number(invoice.taxMinor),
        cardFeeRateBp: invoice.cardFeeRateBpApplied,
        partialPaymentEnabled: invoice.brand.settings?.partialPaymentEnabled ?? false,
        enabledMethods: {
          card: invoice.brand.settings?.cardEnabled ?? false,
          applePay: invoice.brand.settings?.applePayEnabled ?? false,
          googlePay: invoice.brand.settings?.googlePayEnabled ?? false,
          ach: invoice.brand.settings?.achEnabled ?? false,
          check: invoice.brand.settings?.checkEnabled ?? false,
        },
        stripePublishableKey,
        stripeAccountId,
      };
    });
  }
}
