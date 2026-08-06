import Link from 'next/link';
import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands } from '@/lib/api';
import { CustomerForm } from './customer-form';
import { PageContainer } from '@/components/page-container';

const FALLBACK_THEME_COLOUR = '#16261F';

export const dynamic = 'force-dynamic';

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const { brandId } = await searchParams;

  if (!brandId) {
    return (
      <PageContainer narrow>
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
          <p className="font-medium">No brand selected.</p>
          <p className="mt-1">
            Go back to{' '}
            <Link href="/customers" className="underline">
              Customers
            </Link>{' '}
            and choose a brand first.
          </p>
        </div>
      </PageContainer>
    );
  }

  let brandName = brandId;
  let themeColour = FALLBACK_THEME_COLOUR;
  try {
    const brands = await listBrands();
    const brand = brands.find((b) => b.id === brandId);
    if (brand) {
      brandName = brand.displayName;
      themeColour = brand.themeColor;
    }
  } catch (cause) {
    // Non-fatal — the form still works with just the id; only the header
    // label and theme degrade to the fallback.
    if (!(cause instanceof ApiError)) throw cause;
  }

  return (
    <BrandTheme brandColour={themeColour}>
      <PageContainer narrow>
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-ink-subtle">{brandName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Add customer</h1>
        </header>
        <CustomerForm brandId={brandId} />
      </PageContainer>
    </BrandTheme>
  );
}
