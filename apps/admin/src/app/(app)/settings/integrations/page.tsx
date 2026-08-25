import Link from 'next/link';
import {
  ApiError,
  getPaymentMethodSettings,
  getZohoActivity,
  getZohoStatus,
  listBrands,
  listPaymentGateways,
  listPaymentTransactions,
  stripeConnectUrl,
  type Brand,
  type PaymentGatewayProvider,
  type PaymentGatewaySummary,
  type PaymentMethodSettings,
  type PaymentTransactionListResponse,
  type ZohoActivityEntry,
  type ZohoConnectionStatus,
} from '@/lib/api';
import { PaymentGatewaysPanel } from './payment-gateways-panel';
import { ZohoPanel } from './zoho-panel';
import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

type Tab = 'zoho' | 'payments';

const PAYMENT_GATEWAY_PROVIDERS = ['STRIPE', 'PAYPAL', 'SQUARE', 'AUTHORIZE_NET'] as const;

function parseGatewayProvider(value: string | undefined): PaymentGatewayProvider | null {
  const upper = value?.toUpperCase();
  return (PAYMENT_GATEWAY_PROVIDERS as readonly string[]).includes(upper ?? '')
    ? (upper as PaymentGatewayProvider)
    : null;
}

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
    gateway?: string;
    connected?: string;
    error?: string;
    stripeConnected?: string;
    stripeDisconnected?: string;
    stripeError?: string;
  }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === 'payments' ? 'payments' : 'zoho';
  const selectedGateway = parseGatewayProvider(params.gateway);

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
  let gateways: PaymentGatewaySummary[] = [];
  let gatewaysError: string | null = null;
  let methodSettings: PaymentMethodSettings | null = null;
  let transactions: PaymentTransactionListResponse | null = null;

  if (activeBrand && tab === 'zoho') {
    try {
      // Neither call depends on the other's result — fetched together.
      [zohoStatus, zohoActivity] = await Promise.all([
        getZohoStatus(activeBrand.id),
        getZohoActivity(activeBrand.id),
      ]);
    } catch (cause) {
      zohoError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }
  if (activeBrand && tab === 'payments') {
    try {
      gateways = await listPaymentGateways(activeBrand.id);
    } catch (cause) {
      gatewaysError = cause instanceof ApiError ? cause.message : String(cause);
    }

    // The detail view's own sections only matter once that gateway is
    // actually connected — a selected-but-disconnected provider (e.g. a
    // stale link) just falls back to the list.
    const detail = selectedGateway && gateways.find((g) => g.provider === selectedGateway);
    if (detail?.connected) {
      // Neither call depends on the other's result — fetched together.
      [methodSettings, transactions] = await Promise.all([
        getPaymentMethodSettings(activeBrand.id),
        listPaymentTransactions(activeBrand.id, { pageSize: 50 }),
      ]);
    }
  }

  const zohoErrorMessage = params.error
    ? (ZOHO_ERROR_MESSAGES[params.error] ?? params.error)
    : null;

  return (
    <PageContainer>
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
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
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
                  // See IntegrationsPanel's own key comment (brand-settings
                  // page) — same fix, same reason: ZohoPanel keeps
                  // connection status in client state that a brand switch
                  // via router.push does not otherwise reset.
                  key={activeBrand.id}
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

            {gatewaysError ? (
              <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                Could not load payment gateways: {gatewaysError}
              </div>
            ) : (
              <PaymentGatewaysPanel
                // Same stale-client-state fix as ZohoPanel above — this
                // panel's gateway list and its Payment Methods toggles are
                // also held in useState(initial...).
                key={activeBrand.id}
                brandId={activeBrand.id}
                brandDisplayName={activeBrand.displayName}
                stripeConnectUrl={stripeConnectUrl(activeBrand.id)}
                initialGateways={gateways}
                selected={selectedGateway}
                initialMethodSettings={methodSettings}
                initialTransactions={transactions}
              />
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
