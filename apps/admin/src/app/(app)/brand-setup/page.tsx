import { listBrands } from '@/lib/api';
import { PageContainer } from '@/components/page-container';
import { BrandDetailsForm } from './brand-details-form';
import { BrandSetupTabs, NotBuiltYet, isBrandSetupTab, type BrandSetupTab } from './tabs';

export const dynamic = 'force-dynamic';

/**
 * The sidebar's "Brand Setup" destination. Scoped to whichever brand the
 * sidebar's brandId query param currently points at — the same convention
 * every other brand-scoped page in this app already follows.
 *
 * All four designed sections appear as tabs. Only Brand Details is built; the
 * other three say so in plain words rather than being hidden. Hiding them made
 * the page look finished when it is not, and a tab that explains itself costs
 * a reader less than a section that silently does not exist.
 */
export default async function BrandSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const brands = await listBrands();
  const brand = brands.find((b) => b.id === params.brandId) ?? brands[0];
  const active: BrandSetupTab = isBrandSetupTab(params.tab) ? params.tab : 'details';

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold text-ink-strong">Brand Setup</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Configure your brand&rsquo;s identity, invoice templates, and customer-facing payment
        experience.
      </p>

      <BrandSetupTabs active={active} brandId={brand?.id} />

      {!brand ? (
        <p className="mt-8 text-sm text-ink-muted">No brand exists to configure yet.</p>
      ) : active === 'details' ? (
        <div className="mt-8">
          <BrandDetailsForm brand={brand} />
        </div>
      ) : (
        <NotBuiltYet tab={active} />
      )}
    </PageContainer>
  );
}
