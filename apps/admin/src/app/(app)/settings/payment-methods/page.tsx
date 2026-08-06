import Link from 'next/link';
import { BrandTheme } from '@/components/brand-theme';
import { ApiError, getPaymentMethodSettings, listBrands, type Brand } from '@/lib/api';
import { MethodsForm } from './methods-form';
import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

export default async function PaymentMethodsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brandId?: string;
    saved?: string;
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

  let settingsError: string | null = null;
  let initial = {
    cardEnabled: true,
    applePayEnabled: false,
    googlePayEnabled: false,
    achEnabled: false,
    checkEnabled: false,
  };
  if (activeBrand) {
    try {
      initial = await getPaymentMethodSettings(activeBrand.id);
    } catch (cause) {
      settingsError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer>
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-ink-subtle">
            {activeBrand ? activeBrand.displayName : 'Fenwick Holdings Inc.'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Payment methods</h1>
          <p className="mt-2 text-ink-muted">
            FR-PAY-005. What this brand's payment page actually offers — enforced server-side, not
            just hidden in the UI.
          </p>
        </header>

        {brandsError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load brands: {brandsError}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm text-ink-muted">No brands exist yet.</p>
            <Link
              href="/brands/new"
              className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              Create your first brand
            </Link>
          </div>
        ) : (
          <>
            {params.saved && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Saved.
              </div>
            )}

            {settingsError ? (
              <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
                Could not load settings: {settingsError}
              </div>
            ) : (
              activeBrand && <MethodsForm brandId={activeBrand.id} initial={initial} />
            )}

            {/* Stripe's own connection card lives on the Payment Gateways tab
                of /settings/integrations now — this page only owns which
                methods the public payment page offers. */}
            {activeBrand && (
              <p className="mt-6 text-sm text-ink-muted">
                Card payments need a connected gateway to actually charge anything — connect one on{' '}
                <Link
                  href={`/settings/integrations?tab=payments&brandId=${activeBrand.id}`}
                  className="font-medium text-ink-strong underline"
                >
                  the Payment Gateways tab
                </Link>
                .
              </p>
            )}
          </>
        )}
      </PageContainer>
    </BrandTheme>
  );
}
