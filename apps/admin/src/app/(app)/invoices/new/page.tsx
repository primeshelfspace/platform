import Link from 'next/link';
import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands, listCustomers } from '@/lib/api';
import { InvoiceForm } from './invoice-form';
import { PageContainer } from '@/components/page-container';

const FALLBACK_THEME_COLOUR = '#16261F';

export default async function NewInvoicePage({
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
            <Link href="/invoices" className="underline">
              Invoices
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
    if (!(cause instanceof ApiError)) throw cause;
  }

  let customers: Awaited<ReturnType<typeof listCustomers>>['data'] = [];
  let customersError: string | null = null;
  try {
    customers = (await listCustomers(brandId)).data;
  } catch (cause) {
    customersError = cause instanceof ApiError ? cause.message : String(cause);
  }

  return (
    <BrandTheme brandColour={themeColour}>
      <PageContainer narrow>
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-ink-subtle">{brandName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Create invoice</h1>
        </header>

        {customersError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load customers: {customersError}
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
            {brandName} has no customers yet.{' '}
            <Link href={`/customers/new?brandId=${brandId}`} className="underline">
              Add one first
            </Link>
            .
          </div>
        ) : (
          <InvoiceForm brandId={brandId} customers={customers} />
        )}
      </PageContainer>
    </BrandTheme>
  );
}
