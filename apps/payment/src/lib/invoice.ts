/**
 * Public invoice lookup.
 *
 * The token is the only credential (NFR-SEC-014). Every failure — unknown
 * token, deactivated token, brand mismatch — resolves to the same terminal
 * page, so the endpoint cannot be used to probe which invoices exist
 * (TDD-001 §12.1 step 4).
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface PublicInvoice {
  number: string;
  status: string;
  currency: string;
  dueDate: string;
  totalMinor: number;
  balanceMinor: number;
  brand: { displayName: string; themeColor: string; logoUrl: string | null };
  /** Brand Settings > Branding > Payment Page — drives this page's header
   * layout and the colour of its actionable elements. */
  accentColor: string;
  paymentPageLayout: 'BANNER' | 'CENTERED' | 'SPLIT';
  lines: Array<{
    itemName: string;
    description: string | null;
    quantity: string;
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

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export async function lookupInvoice(token: string): Promise<InvoiceLookup> {
  // Reject malformed tokens before a network call: it costs nothing and keeps
  // obvious probing off the API entirely.
  if (!TOKEN_PATTERN.test(token)) return { state: 'not-found' };

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
