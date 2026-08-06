import { listBrands } from '@/lib/api';
import { BrandDetailsForm } from './brand-details-form';
import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

/**
 * The sidebar's "Brand Setup" destination. Scoped to whichever brand the
 * sidebar's brandId query param currently points at — the same convention
 * every other brand-scoped page in this app already follows.
 *
 * Only the "Brand Details" content exists today. The reference design this
 * was built from also shows Invoice PDF, Email Template and Payment Page as
 * sibling tabs; those pages don't exist yet, so no tab bar is rendered
 * rather than one that would point at broken links.
 */
export default async function BrandSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const { brandId } = await searchParams;
  const brands = await listBrands();
  const brand = brands.find((b) => b.id === brandId) ?? brands[0];

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold text-ink-strong">Brand Setup</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Configure your brand&rsquo;s identity, invoice templates, and customer-facing payment
        experience.
      </p>

      {brand ? (
        <div className="mt-8">
          <BrandDetailsForm brand={brand} />
        </div>
      ) : (
        <p className="mt-8 text-sm text-ink-muted">No brand exists to configure yet.</p>
      )}
    </PageContainer>
  );
}
