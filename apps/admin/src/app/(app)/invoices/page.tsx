import Link from 'next/link';
import { Plus, ScrollText } from 'lucide-react';
import { formatMinorForDisplay } from '@fenwick/shared/money';
import { BrandTheme } from '@/components/brand-theme';
import { ApiError, listBrands, listInvoices, type Brand, type Invoice } from '@/lib/api';
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoice-presentation';
import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; created?: string }>;
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
      invoices = (await listInvoices(activeBrand.id)).data;
    } catch (cause) {
      invoicesError = cause instanceof ApiError ? cause.message : String(cause);
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
            <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Invoices</h1>
            <p className="mt-2 max-w-2xl text-ink-muted">
              FR-INV. Create and issue draws on FakeGateway for payment until Numbers Gateway
              (DEP-01) is resolved.
            </p>
          </div>
          {activeBrand && (
            <Link
              href={`/invoices/new?brandId=${activeBrand.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create invoice
            </Link>
          )}
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
            {params.created && (
              <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
                Invoice created and issued. Its payment link is below.
              </div>
            )}

            <section className="rounded-lg border border-border bg-surface shadow-sm">
              {invoicesError ? (
                <div className="p-6 text-sm text-danger">
                  Could not load invoices: {invoicesError}
                </div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center">
                  <ScrollText className="h-8 w-8 text-ink-subtle" aria-hidden />
                  <p className="font-medium text-ink-strong">No invoices yet</p>
                  <p className="text-sm text-ink-muted">
                    Create the first invoice for {activeBrand?.displayName}.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Total</th>
                      <th className="px-5 py-3">Balance</th>
                      <th className="px-5 py-3">Payment link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 font-medium text-ink-strong">{inv.number}</td>
                        <td className={`px-5 py-3 font-medium ${invoiceStatusTone(inv.status)}`}>
                          {invoiceStatusLabel(inv.status)}
                        </td>
                        <td className="px-5 py-3 font-mono text-ink-strong">
                          {formatMinorForDisplay(inv.totalMinor, inv.currency as 'USD')}
                        </td>
                        <td className="px-5 py-3 font-mono text-ink-strong">
                          {formatMinorForDisplay(inv.balanceMinor, inv.currency as 'USD')}
                        </td>
                        <td className="px-5 py-3">
                          {inv.status === 'DRAFT' ? (
                            <span className="text-xs text-ink-subtle">Not issued</span>
                          ) : (
                            <a
                              href={`${PAYMENT_PUBLIC_URL}/i/${inv.publicToken}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-brand-ink underline"
                            >
                              Open payment page
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </PageContainer>
    </BrandTheme>
  );
}
