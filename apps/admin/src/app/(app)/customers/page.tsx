import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands, listCustomers, type Brand, type CustomerListRow } from '@/lib/api';
import { PageContainer } from '@/components/page-container';
import { CustomersPageClient } from './customers-page-client';

/** INK — used only when no brand exists yet, so bg-brand still resolves. */
const FALLBACK_THEME_COLOUR = '#16261F';

/**
 * The API's own page-size ceiling (packages/shared paginationSchema) — the
 * same "fetch the whole small-to-medium thing in one shot" trade-off
 * InvoicesPage already makes (see its own INVOICE_FETCH_PAGE_SIZE comment).
 * Without this, listCustomers silently fell back to the API's default of 25,
 * which for a brand with more customers than that (a freshly Zoho-synced one
 * easily has dozens) left everything past the first page completely
 * unreachable — there is no pagination control on this page, only the
 * "Showing X of Y" caption below the table.
 */
const CUSTOMER_FETCH_PAGE_SIZE = 200;

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    search?: string;
    outstanding?: string;
    archived?: string;
  }>;
}) {
  const params = await searchParams;
  const hasOutstanding = params.outstanding === '1' ? true : undefined;
  const includeArchived = params.archived === '1';

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  const activeBrand = brands.find((b) => b.id === params.brandId) ?? brands[0] ?? null;

  let customers: CustomerListRow[] = [];
  let total = 0;
  let customersError: string | null = null;
  if (activeBrand) {
    try {
      const result = await listCustomers(activeBrand.id, {
        search: params.search,
        hasOutstanding,
        includeArchived,
        pageSize: CUSTOMER_FETCH_PAGE_SIZE,
      });
      customers = result.data;
      total = result.total;
    } catch (cause) {
      customersError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer compact>
        <CustomersPageClient
          brand={activeBrand}
          customers={customers}
          total={total}
          search={params.search ?? ''}
          outstandingOnly={hasOutstanding === true}
          includeArchived={includeArchived}
          brandsError={brandsError}
          hasBrands={brands.length > 0}
          customersError={customersError}
        />
      </PageContainer>
    </BrandTheme>
  );
}
