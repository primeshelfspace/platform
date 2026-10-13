import {
  ApiError,
  getInvoiceTabCounts,
  listBrands,
  listInvoices,
  type Brand,
  type Invoice,
  type InvoiceTabCounts,
} from '@/lib/api';
import { BrandTheme } from '@/components/brand-theme';
import { PageContainer } from '@/components/page-container';
import { invoiceListTabFilter, invoiceRangeCutoffIso } from '@/lib/invoice-presentation';
import { parsePageParams } from '@/lib/pagination';
import { InvoicesPageClient } from './invoices-page-client';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

const EMPTY_TAB_COUNTS: InvoiceTabCounts = {
  all: 0,
  draft: 0,
  unpaid: 0,
  partial: 0,
  paid: 0,
  overdue: 0,
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    created?: string;
    tab?: string;
    search?: string;
    range?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? 'all';
  const search = params.search ?? '';
  const range = params.range ?? '90';
  const { page, pageSize } = parsePageParams(params);
  const dateRange = { from: invoiceRangeCutoffIso(range) };

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  const activeBrand = brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null;

  let invoices: Invoice[] = [];
  let total = 0;
  let tabCounts: InvoiceTabCounts = EMPTY_TAB_COUNTS;
  let invoicesError: string | null = null;
  if (activeBrand) {
    try {
      // Neither call depends on the other's result — the tab badges need
      // every bucket's count under the current search/range regardless of
      // which tab is open, while the table itself needs only the active
      // tab's page.
      const [listResult, counts] = await Promise.all([
        listInvoices(activeBrand.id, {
          page,
          pageSize,
          search: search || undefined,
          dateRange,
          ...invoiceListTabFilter(tab),
        }),
        getInvoiceTabCounts(activeBrand.id, { search: search || undefined, dateRange }),
      ]);
      invoices = listResult.data;
      total = listResult.total;
      tabCounts = counts;
    } catch (cause) {
      invoicesError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer compact>
        <InvoicesPageClient
          brand={activeBrand}
          invoices={invoices}
          total={total}
          page={page}
          pageSize={pageSize}
          tabCounts={tabCounts}
          tab={tab}
          search={search}
          range={range}
          brandsError={brandsError}
          hasBrands={brands.length > 0}
          invoicesError={invoicesError}
          justCreated={Boolean(params.created)}
        />
      </PageContainer>
    </BrandTheme>
  );
}
