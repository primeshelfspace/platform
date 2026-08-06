import Link from 'next/link';
import { Plus, Search, Users } from 'lucide-react';
import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands, listCustomers, type Brand, type Customer } from '@/lib/api';
import { PageContainer } from '@/components/page-container';

/** INK — used only when no brand exists yet, so bg-brand still resolves. */
const FALLBACK_THEME_COLOUR = '#16261F';

export const dynamic = 'force-dynamic';

function formatAddress(address: Customer['billingAddress']): string | null {
  if (!address) return null;
  return [address.line1, address.city, address.region].filter(Boolean).join(', ') || null;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; search?: string; created?: string }>;
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

  let customers: Customer[] = [];
  let total = 0;
  let customersError: string | null = null;
  if (activeBrand) {
    try {
      const result = await listCustomers(activeBrand.id, { search: params.search });
      customers = result.data;
      total = result.total;
    } catch (cause) {
      customersError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <PageContainer>
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-widest text-ink-subtle">
              {activeBrand ? activeBrand.displayName : 'Fenwick Holdings Inc.'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Customers</h1>
            <p className="mt-2 max-w-2xl text-ink-muted">
              Businesses this brand invoices — FR-CUS. Accounts receivable, not vendors.
            </p>
          </div>
          {activeBrand && (
            <Link
              href={`/customers/new?brandId=${activeBrand.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add customer
            </Link>
          )}
        </header>

        {brandsError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            <p className="font-medium">Could not load brands.</p>
            <p className="mt-1 font-mono text-xs">{brandsError}</p>
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
            {params.created && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Customer added.
              </div>
            )}

            <form method="get" className="mb-5 flex gap-2">
              {activeBrand && <input type="hidden" name="brandId" value={activeBrand.id} />}
              <div className="relative flex-1 max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                  aria-hidden
                />
                <input
                  type="search"
                  name="search"
                  defaultValue={params.search ?? ''}
                  placeholder="Search name, company or email"
                  className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-strong"
              >
                Search
              </button>
            </form>

            <section className="rounded-lg border border-border bg-surface shadow-sm">
              {customersError ? (
                <div className="p-6 text-sm text-danger">
                  <p className="font-medium">Could not load customers.</p>
                  <p className="mt-1 font-mono text-xs">{customersError}</p>
                </div>
              ) : customers.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center">
                  <Users className="h-8 w-8 text-ink-subtle" aria-hidden />
                  <p className="font-medium text-ink-strong">No customers yet</p>
                  <p className="text-sm text-ink-muted">
                    {params.search
                      ? 'No customer matches that search.'
                      : `Add the first customer for ${activeBrand?.displayName}.`}
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Contact</th>
                      <th className="px-5 py-3">Location</th>
                      <th className="px-5 py-3">Zoho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3">
                          <div className="font-medium text-ink-strong">{c.displayName}</div>
                          {c.companyName && c.companyName !== c.displayName && (
                            <div className="text-xs text-ink-subtle">{c.companyName}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          <div>{c.email ?? '—'}</div>
                          {c.phone && <div className="text-xs text-ink-subtle">{c.phone}</div>}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {formatAddress(c.billingAddress) ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          {c.zohoContactId ? (
                            <span className="rounded-full bg-accent-surface px-2.5 py-0.5 text-xs text-ink-strong">
                              Synced
                            </span>
                          ) : (
                            <span className="text-xs text-ink-subtle">Not synced</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {total > customers.length && (
              <p className="mt-3 text-xs text-ink-subtle">
                Showing {customers.length} of {total}. Pagination lands with FR-CUS-006 in full.
              </p>
            )}
          </>
        )}
      </PageContainer>
    </BrandTheme>
  );
}
