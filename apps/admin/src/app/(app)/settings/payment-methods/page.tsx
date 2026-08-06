import Link from 'next/link';
import { BrandTheme } from '@/components/brand-theme';
import {
  ApiError,
  getPaymentMethodSettings,
  getStripeAccountStatus,
  stripeConnectUrl,
  type StripeAccountStatus,
  listBrands,
  type Brand,
} from '@/lib/api';
import { StripeForm } from '../stripe/stripe-form';
import { MethodsForm } from './methods-form';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

/**
 * The connect flow returns either a short code it minted itself
 * (`missing_brand`) or a sentence forwarded verbatim from the API
 * ("STRIPE_CONNECT_CLIENT_ID is not configured on this deployment"). Only the
 * former wants its underscores turned into spaces — doing it to the latter
 * mangles the environment variable name the reader needs in order to act.
 */
function describeStripeError(raw: string): string {
  const KNOWN: Record<string, string> = {
    missing_brand: 'No brand was selected.',
    api_unreachable: 'The API could not be reached.',
    connect_failed: 'Stripe did not return a consent link.',
    invalid_or_expired_state: 'That connection link expired. Try again.',
    unknown_brand: 'That brand no longer exists.',
  };
  return KNOWN[raw] ?? raw;
}

export default async function PaymentMethodsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    saved?: string;
    /** Set by the Stripe Connect callback on the way back from Stripe. */
    stripeConnected?: string;
    stripeDisconnected?: string;
    stripeError?: string;
  }>;
}) {
  const params = await searchParams;

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  const activeBrand = brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null;

  let settingsError: string | null = null;
  let initial = {
    cardEnabled: true,
    applePayEnabled: false,
    googlePayEnabled: false,
    achEnabled: false,
    checkEnabled: false,
  };
  let stripeStatusError: string | null = null;
  let stripeStatus: StripeAccountStatus = {
    connected: false,
    accountId: null,
    displayName: null,
    chargesEnabled: false,
  };
  if (activeBrand) {
    try {
      initial = await getPaymentMethodSettings(activeBrand.id);
    } catch (cause) {
      settingsError = cause instanceof ApiError ? cause.message : String(cause);
    }
    try {
      stripeStatus = await getStripeAccountStatus(activeBrand.id);
    } catch (cause) {
      stripeStatusError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <main className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-ink-subtle">
            {activeBrand ? activeBrand.displayName : 'Fenwick Holdings Inc.'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Payment methods</h1>
          <p className="mt-2 text-ink-muted">
            FR-PAY-005. What this brand's payment page actually offers — enforced server-side, not
            just hidden in the UI.
          </p>
        </header>

        {brandsError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load brands: {brandsError}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm text-ink-muted">No brands exist yet.</p>
            <Link
              href="/brands/new"
              className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              Create your first brand
            </Link>
          </div>
        ) : (
          <>
            {params.saved && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Saved.
              </div>
            )}
            {params.stripeConnected && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Stripe connected.
              </div>
            )}
            {params.stripeDisconnected && (
              <div className="mb-4 rounded-md bg-surface-muted p-3 text-sm text-ink-muted">
                Stripe disconnected.
              </div>
            )}
            {params.stripeError && (
              <div className="mb-4 rounded-md bg-danger-surface p-3 text-sm text-danger">
                Stripe could not be connected: {describeStripeError(params.stripeError)}
              </div>
            )}

            {settingsError ? (
              <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                Could not load settings: {settingsError}
              </div>
            ) : (
              activeBrand && <MethodsForm brandId={activeBrand.id} initial={initial} />
            )}

            {activeBrand && (
              <div className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-sm">
                <div className="mb-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-ink-strong">Stripe</h2>
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        stripeStatus.connected ? 'bg-success' : 'bg-ink-subtle'
                      }`}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {stripeStatus.connected
                      ? `Connected${stripeStatus.displayName ? ` — ${stripeStatus.displayName}` : ''}`
                      : 'Not connected — card payments above will fail until this brand connects its Stripe account.'}
                  </p>
                </div>

                {stripeStatusError ? (
                  <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                    Could not load Stripe status: {stripeStatusError}
                  </div>
                ) : (
                  <StripeForm
                    brandId={activeBrand.id}
                    connected={stripeStatus.connected}
                    connectUrl={stripeConnectUrl(activeBrand.id)}
                    displayName={stripeStatus.displayName}
                    accountId={stripeStatus.accountId}
                    chargesEnabled={stripeStatus.chargesEnabled}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </BrandTheme>
  );
}
