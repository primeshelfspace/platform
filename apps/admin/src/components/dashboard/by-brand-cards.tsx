import Link from 'next/link';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { BrandRollup } from '@/lib/api';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** Only rendered in All Brands mode — a per-brand rollup scoped to one brand
 * would be a contradiction in terms. */
export function ByBrandCards({ brands }: { brands: BrandRollup[] }) {
  if (brands.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 font-medium text-ink-strong">By Brand</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {brands.map((brand) => {
          const currency = toCurrencyCode(brand.currency);
          return (
            <Link
              key={brand.brandId}
              href={`/?brandId=${brand.brandId}`}
              className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-brand-ink"
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                  style={{ backgroundColor: brand.themeColor }}
                  aria-hidden
                >
                  {initialOf(brand.brandName)}
                </span>
                <span className="truncate text-sm font-semibold text-ink-strong">
                  {brand.brandName}
                </span>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-ink-subtle">Invoiced</dt>
                  <dd className="font-medium text-ink-strong">
                    {formatMinorForDisplay(brand.invoicedMinor, currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-subtle">Collected</dt>
                  <dd className="font-medium text-success">
                    {formatMinorForDisplay(brand.collectedMinor, currency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-subtle">Collection Rate</dt>
                  <dd className="font-medium text-ink-strong">
                    {(brand.collectionRate * 100).toFixed(1)}%
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-subtle">Overdue</dt>
                  <dd className="font-medium text-danger">
                    {formatMinorForDisplay(brand.overdueMinor, currency)}
                  </dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
