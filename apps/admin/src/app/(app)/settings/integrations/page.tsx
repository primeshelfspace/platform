import Link from 'next/link';
import {
  ApiError,
  getStripeAccountStatus,
  getZohoActivity,
  getZohoStatus,
  listBrands,
  stripeConnectUrl,
  type Brand,
  type StripeAccountStatus,
  type ZohoActivityEntry,
  type ZohoConnectionStatus,
} from '@/lib/api';
import { StripeForm } from '../stripe/stripe-form';
import { ZohoPanel } from './zoho-panel';

export const dynamic = 'force-dynamic';

type Tab = 'zoho' | 'payments';

const ZOHO_ERROR_MESSAGES: Record<string, string> = {
  missing_brand: 'No brand was selected.',
  connect_failed: 'Could not reach the API to start the Zoho connection.',
  invalid_or_expired_state: 'That connection link expired — start again.',
  no_organizations: 'That Zoho account has no organizations in Zoho Books to connect.',
  unknown_brand: 'This brand could not be resolved.',
};

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

function tabHref(tab: Tab, brandId: string): string {
  return `/settings/integrations?tab=${tab}${brandId ? `&brandId=${brandId}` : ''}`;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    tab?: string;
    connected?: string;
    error?: string;
    stripeConnected?: string;
    stripeDisconnected?: string;
    stripeError?: string;
  }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === 'payments' ? 'payments' : 'zoho';

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  const activeBrand = brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null;

  let zohoStatus: ZohoConnectionStatus | null = null;
  let zohoActivity: ZohoActivityEntry[] = [];
  let zohoError: string | null = null;
  let stripeStatus: StripeAccountStatus | null = null;
  let stripeError: string | null = null;

  if (activeBrand && tab === 'zoho') {
    try {
      zohoStatus = await getZohoStatus(activeBrand.id);
      zohoActivity = await getZohoActivity(activeBrand.id);
    } catch (cause) {
      zohoError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }
  if (activeBrand && tab === 'payments') {
    try {
      stripeStatus = await getStripeAccountStatus(activeBrand.id);
    } catch (cause) {
      stripeError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  const zohoErrorMessage = params.error ? (ZOHO_ERROR_MESSAGES[params.error] ?? params.error) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10">
      <h1 className="text-[32px] font-bold leading-tight text-ink-strong">Integrations</h1>
      <p className="mt-1 text-base text-ink-muted">
        Every brand connects to its own integrations, and payment gateways.
      </p>

      <div className="mt-6 flex gap-6 border-b border-border">
        <Link
          href={tabHref('zoho', activeBrand?.id ?? '')}
          aria-current={tab === 'zoho' ? 'page' : undefined}
          className={`-mb-px border-b-2 pb-3 text-sm ${
            tab === 'zoho'
              ? 'border-ink-strong font-bold text-ink-strong'
              : 'border-transparent font-medium text-ink-muted hover:text-ink-strong'
          }`}
        >
          Zoho Books
        </Link>
        <Link
          href={tabHref('payments', activeBrand?.id ?? '')}
          aria-current={tab === 'payments' ? 'page' : undefined}
          className={`-mb-px border-b-2 pb-3 text-sm ${
            tab === 'payments'
              ? 'border-ink-strong font-bold text-ink-strong'
              : 'border-transparent font-medium text-ink-muted hover:text-ink-strong'
          }`}
        >
          Payment Gateways
        </Link>
      </div>

      <div className="mt-6">
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
        ) : !activeBrand ? null : tab === 'zoho' ? (
          <>
            {params.connected && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Connected.
              </div>
            )}
            {zohoErrorMessage && (
              <div className="mb-4 rounded-md bg-danger-surface p-3 text-sm text-danger">
                {zohoErrorMessage}
              </div>
            )}
            {zohoError ? (
              <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                Could not load connection status: {zohoError}
              </div>
            ) : (
              zohoStatus && (
                <ZohoPanel
                  brandId={activeBrand.id}
                  brandDisplayName={activeBrand.displayName}
                  connectHref={`/settings/zoho/connect?brandId=${activeBrand.id}`}
                  initialStatus={zohoStatus}
                  initialActivity={zohoActivity}
                />
              )
            )}
          </>
        ) : (
          <>
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

            {stripeError ? (
              <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                Could not load Stripe status: {stripeError}
              </div>
            ) : (
              stripeStatus && (
                <div className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
                  <div className="mb-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-ink-strong">Stripe</h2>
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
                        : 'Not connected — card payments will fail until this brand connects its Stripe account.'}
                    </p>
                  </div>

                  <StripeForm
                    brandId={activeBrand.id}
                    connected={stripeStatus.connected}
                    connectUrl={stripeConnectUrl(activeBrand.id)}
                    displayName={stripeStatus.displayName}
                    accountId={stripeStatus.accountId}
                    chargesEnabled={stripeStatus.chargesEnabled}
                  />
                </div>
              )
            )}
          </>
        )}
      </div>
    </main>
  );
}
