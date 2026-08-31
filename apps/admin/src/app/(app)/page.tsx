import Link from 'next/link';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { toCurrencyCode } from '@fenwick/shared/money';
import { BrandTheme } from '@/components/brand-theme';
import { ByBrandCards } from '@/components/dashboard/by-brand-cards';
import { CollectionRateTrendChart } from '@/components/dashboard/collection-rate-trend-chart';
import { CrossBrandCustomersTable } from '@/components/dashboard/cross-brand-customers-table';
import { InvoicedVsCollectedChart } from '@/components/dashboard/invoiced-vs-collected-chart';
import { InvoiceStatusDonut } from '@/components/dashboard/invoice-status-donut';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { NeedsAttention } from '@/components/dashboard/needs-attention';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { TopOverdueCustomers } from '@/components/dashboard/top-overdue-customers';
import {
  ApiError,
  getDashboardByBrand,
  getDashboardCrossBrandCustomers,
  getDashboardNeedsAttention,
  getDashboardRecentActivity,
  getDashboardStatusBreakdown,
  getDashboardSummary,
  getDashboardTopOverdueCustomers,
  getDashboardTrend,
  getZohoStatus,
  listBrands,
  type Brand,
  type BrandRollup,
  type CrossBrandCustomersResult,
  type DashboardStatusBucket,
  type DashboardSummary,
  type DashboardTrendPoint,
  type NeedsAttentionResult,
  type RecentActivityItem,
  type TopOverdueCustomer,
} from '@/lib/api';
import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

function settled<T>(outcome: PromiseSettledResult<T>, fallback: T): T {
  return outcome.status === 'fulfilled' ? outcome.value : fallback;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; brandCreated?: string }>;
}) {
  const params = await searchParams;

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  // 'all' is the explicit, bookmarkable "All Brands" value — only reachable
  // with more than one brand, same rule the sidebar's switcher enforces.
  const allBrandsSelected = params.brandId === 'all' && brands.length > 1;
  const activeBrand = allBrandsSelected
    ? null
    : (brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null);
  // null means "every brand this session can read" — every dashboard
  // endpoint below treats that as its own request, not a client-side loop.
  const scopeBrandId = allBrandsSelected ? null : (activeBrand?.id ?? null);

  let summary: DashboardSummary | null = null;
  let trend: DashboardTrendPoint[] = [];
  let statusBreakdown: DashboardStatusBucket[] = [];
  let topOverdueCustomers: TopOverdueCustomer[] = [];
  let needsAttention: NeedsAttentionResult = { items: [], totalCount: 0 };
  let recentActivity: RecentActivityItem[] = [];
  let byBrand: BrandRollup[] = [];
  let crossBrandCustomers: CrossBrandCustomersResult = { rows: [], matchedCount: 0 };
  let zohoConnected = false;
  let zohoLastSyncAt: string | null = null;
  let dataError: string | null = null;

  if (brands.length > 0) {
    try {
      const [
        summaryOutcome,
        trendOutcome,
        statusOutcome,
        topOverdueOutcome,
        needsAttentionOutcome,
        recentActivityOutcome,
        byBrandOutcome,
        crossBrandOutcome,
        zohoOutcome,
      ] = await Promise.allSettled([
        getDashboardSummary(scopeBrandId),
        getDashboardTrend(scopeBrandId),
        getDashboardStatusBreakdown(scopeBrandId),
        getDashboardTopOverdueCustomers(scopeBrandId),
        getDashboardNeedsAttention(scopeBrandId),
        getDashboardRecentActivity(scopeBrandId),
        // Only meaningful in All Brands mode — skip the round trip otherwise.
        scopeBrandId === null ? getDashboardByBrand() : Promise.resolve<BrandRollup[]>([]),
        scopeBrandId === null
          ? getDashboardCrossBrandCustomers()
          : Promise.resolve<CrossBrandCustomersResult>({ rows: [], matchedCount: 0 }),
        activeBrand
          ? getZohoStatus(activeBrand.id)
          : Promise.resolve({
              connected: false,
              organizationName: null,
              lastSyncAt: null,
              lastPulledAt: null,
              health: null,
              pullFrequencyMinutes: 15,
              customerSyncEnabled: true,
              invoiceSyncEnabled: true,
            }),
      ]);

      if (summaryOutcome.status === 'rejected') {
        throw summaryOutcome.reason; // the KPI cards are the one widget worth failing the page over
      }
      summary = summaryOutcome.value;
      trend = settled(trendOutcome, []);
      statusBreakdown = settled(statusOutcome, []);
      topOverdueCustomers = settled(topOverdueOutcome, []);
      needsAttention = settled(needsAttentionOutcome, { items: [], totalCount: 0 });
      recentActivity = settled(recentActivityOutcome, []);
      byBrand = settled(byBrandOutcome, []);
      crossBrandCustomers = settled(crossBrandOutcome, { rows: [], matchedCount: 0 });
      const zohoStatus = settled(zohoOutcome, {
        connected: false,
        organizationName: null,
        lastSyncAt: null,
        lastPulledAt: null,
        health: null,
        pullFrequencyMinutes: 15,
        customerSyncEnabled: true,
        invoiceSyncEnabled: true,
      });
      zohoConnected = zohoStatus.connected;
      zohoLastSyncAt = zohoStatus.lastSyncAt;
    } catch (cause) {
      dataError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  const currency = toCurrencyCode(summary?.currency ?? activeBrand?.currency);

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-widest text-ink-subtle">
              {activeBrand ? activeBrand.displayName : 'All Brands'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Dashboard</h1>
            <p className="text-sm text-ink-muted">Finance overview &amp; collection performance</p>
          </div>
        </header>

        {params.brandCreated && (
          <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
            Brand created.
          </div>
        )}

        {brandsError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load brands: {brandsError}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <p className="text-sm text-ink-muted">No brands exist yet.</p>
            <Link
              href="/brands/structure"
              className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              Create your first brand
            </Link>
          </div>
        ) : dataError || !summary ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load dashboard data: {dataError ?? 'unknown error'}
          </div>
        ) : (
          <>
            {activeBrand && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-ink-muted">
                  {zohoConnected ? (
                    <CircleCheck className="h-4 w-4 text-success" aria-hidden />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-ink-subtle" aria-hidden />
                  )}
                  Zoho Books: {zohoConnected ? 'Connected' : 'Not connected'}
                  {zohoConnected && zohoLastSyncAt && (
                    <span className="text-ink-subtle">
                      · Last synced {new Date(zohoLastSyncAt).toLocaleString()}
                    </span>
                  )}
                </span>
                {needsAttention.totalCount > 0 && (
                  <a href="#needs-attention" className="font-medium text-danger hover:underline">
                    {needsAttention.totalCount} item{needsAttention.totalCount === 1 ? '' : 's'}{' '}
                    need attention →
                  </a>
                )}
              </div>
            )}

            <KpiCards summary={summary} />

            {scopeBrandId === null && <ByBrandCards brands={byBrand} />}

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <CollectionRateTrendChart trend={trend} />
              <InvoiceStatusDonut buckets={statusBreakdown} currency={currency} />
            </div>

            <div className="mb-6">
              <InvoicedVsCollectedChart trend={trend} currency={currency} />
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <TopOverdueCustomers customers={topOverdueCustomers} currency={currency} />
              <div id="needs-attention">
                <NeedsAttention result={needsAttention} brandId={scopeBrandId} />
              </div>
            </div>

            <div className="mb-6">
              <RecentActivity items={recentActivity} />
            </div>

            {scopeBrandId === null && (
              <CrossBrandCustomersTable result={crossBrandCustomers} brands={brands} />
            )}
          </>
        )}
      </PageContainer>
    </BrandTheme>
  );
}
