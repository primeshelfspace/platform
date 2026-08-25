/**
 * Public invoice lookup.
 *
 * The token is the only credential (NFR-SEC-014). Every failure — unknown
 * token, deactivated token, brand mismatch — resolves to the same terminal
 * page, so the endpoint cannot be used to probe which invoices exist
 * (TDD-001 §12.1 step 4).
 */

import { type InvoiceStatus, publicTokenSchema } from '@fenwick/shared';
import { API_URL } from './env';

/** Brand Settings > Branding > Invoice PDF — the same settings the admin's
 * Invoice PDF editor previews, mirrored here so the public invoice page can
 * render the document per the actual saved layout/fields/notes rather than
 * a fixed generic summary. */
export interface PublicInvoicePdfSettings {
  invoicePdfLayout: 'CLASSIC' | 'MODERN' | 'MINIMAL';
  showCompanyAddress: boolean;
  showPaymentTerms: boolean;
  showTaxBreakdown: boolean;
  showNotes: boolean;
  companyName: string;
  companyAddress: string;
  paymentTerms: 'DUE_ON_RECEIPT' | 'NET_15' | 'NET_30' | 'NET_60';
  notes: string;
}

export interface PublicInvoice {
  number: string;
  status: InvoiceStatus;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  totalMinor: number;
  balanceMinor: number;
  brand: { displayName: string; themeColor: string; logoUrl: string | null };
  /** Brand Settings > Branding > Payment Page — drives this page's header
   * layout and the colour of its actionable elements. */
  accentColor: string;
  paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
  customerName: string;
  /** Multi-line (newline-separated), possibly empty. */
  customerAddress: string;
  invoicePdf: PublicInvoicePdfSettings;
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
  enabledMethods: {
    card: boolean;
    applePay: boolean;
    googlePay: boolean;
    ach: boolean;
    check: boolean;
  };
  /** The platform's Stripe publishable key. Served by the API rather than baked
   * into this app's build, so it stays a deployment concern rather than a
   * rebuild. Null if this deployment has no Stripe configured. */
  stripePublishableKey: string | null;
  /** This brand's connected account (acct_…), passed to Stripe.js alongside the
   * key above so Elements confirms against the right account (Stripe Connect).
   * Null if the brand has not completed the connect flow. */
  stripeAccountId: string | null;
}

export type InvoiceLookup =
  | { state: 'found'; invoice: PublicInvoice }
  | { state: 'not-found' }
  | { state: 'unavailable'; detail: string };

export async function lookupInvoice(token: string): Promise<InvoiceLookup> {
  // Reject malformed tokens before a network call: it costs nothing and keeps
  // obvious probing off the API entirely.
  if (!publicTokenSchema.safeParse(token).success) return { state: 'not-found' };

  try {
    const response = await fetch(`${API_URL}/public/invoices/${token}`, { cache: 'no-store' });

    if (response.status === 404 || response.status === 410) return { state: 'not-found' };
    if (!response.ok) {
      return { state: 'unavailable', detail: `${response.status} ${response.statusText}` };
    }

    return { state: 'found', invoice: (await response.json()) as PublicInvoice };
  } catch (error) {
    // A network failure is not a missing invoice. Saying "not found" here would
    // tell a customer their perfectly valid link is dead.
    return { state: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}
