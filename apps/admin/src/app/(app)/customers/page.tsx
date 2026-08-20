import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands, listCustomers, type Brand, type CustomerListRow } from '@/lib/api';
import { PageContainer } from '@/components/page-container';
import { CustomersPageClient } from './customers-page-client';

/** INK — used only when no brand exists yet, so bg-brand still resolves. */
const FALLBACK_THEME_COLOUR = '#16261F';

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
