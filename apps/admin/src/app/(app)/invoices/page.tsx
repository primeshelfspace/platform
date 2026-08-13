import { ApiError, listBrands, listInvoices, type Brand, type Invoice } from '@/lib/api';
import { BrandTheme } from '@/components/brand-theme';
import { PageContainer } from '@/components/page-container';
import { InvoicesPageClient } from './invoices-page-client';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

/** Large enough that a brand's full invoice history fits in one fetch — the
 * tabs' counts and the date-range filter both need the complete set, not
 * just one page of it (the same "fetch the whole small thing" trade-off
 * CustomersPageClient makes, surfaced there as "Showing X of Y"). */
const INVOICE_FETCH_PAGE_SIZE = 200;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    created?: string;
    tab?: string;
    search?: string;
    range?: string;
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

  let invoices: Invoice[] = [];
  let invoicesError: string | null = null;
  if (activeBrand) {
    try {
      invoices = (await listInvoices(activeBrand.id, { pageSize: INVOICE_FETCH_PAGE_SIZE })).data;
    } catch (cause) {
      invoicesError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer>
        <InvoicesPageClient
          brand={activeBrand}
          invoices={invoices}
          tab={params.tab ?? 'all'}
          search={params.search ?? ''}
          range={params.range ?? '90'}
          paymentPublicUrl={PAYMENT_PUBLIC_URL}
          brandsError={brandsError}
          hasBrands={brands.length > 0}
          invoicesError={invoicesError}
          justCreated={Boolean(params.created)}
        />
      </PageContainer>
    </BrandTheme>
  );
}
