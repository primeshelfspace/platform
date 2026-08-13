import Link from 'next/link';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import { BrandTheme } from '@/components/brand-theme';
import { PageContainer } from '@/components/page-container';
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoice-presentation';
import {
  ApiError,
  getCustomer,
  listBrands,
  listInvoices,
  type Brand,
  type Customer,
  type CustomerAddress,
  type Invoice,
} from '@/lib/api';

const FALLBACK_THEME_COLOUR = '#16261F';

export const dynamic = 'force-dynamic';

function formatAddress(address: CustomerAddress | null): string | null {
  if (!address) return null;
  return (
    [
      address.line1,
      address.line2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .filter(Boolean)
      .join(', ') || null
  );
}

/**
 * Bare-bones — name, contact, both addresses, and this customer's invoices.
 * Enough to make the listing's "View" button go somewhere real; a fuller
 * profile (edit, notes, Zoho sync status) is its own follow-up.
 */
export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ brandId?: string }>;
}) {
  const { id } = await params;
  const { brandId } = await searchParams;

  let brands: Brand[] = [];
  try {
    brands = await listBrands();
  } catch {
    // Non-fatal — the page still works with just the brandId query param.
  }
  const activeBrand = brands.find((b) => b.id === brandId) ?? brands[0] ?? null;

  if (!activeBrand) {
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

  // Neither call reads the other's result — both only need activeBrand.id and
  // the id already in the URL — so they run together. If the customer fetch
  // fails the invoices result is simply discarded below, the one case where
  // this costs a request the sequential version wouldn't have made.
  const [customerOutcome, invoicesOutcome] = await Promise.allSettled([
    getCustomer(activeBrand.id, id),
    listInvoices(activeBrand.id, { customerId: id }),
  ]);

  let customer: Customer | null = null;
  let loadError: string | null = null;
  if (customerOutcome.status === 'fulfilled') {
    customer = customerOutcome.value;
  } else {
    const cause = customerOutcome.reason;
    loadError = cause instanceof ApiError ? cause.message : String(cause);
  }

  let invoices: Invoice[] = [];
  // The customer's own details still render without their invoice history.
  if (customer && invoicesOutcome.status === 'fulfilled') {
    invoices = invoicesOutcome.value.data;
  }

  return (
    <BrandTheme brandColour={activeBrand.themeColor}>
      <PageContainer>
        <Link
          href={`/customers?brandId=${activeBrand.id}`}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink-strong"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Customers
        </Link>

        {loadError || !customer ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            <p className="font-medium">Could not load this customer.</p>
            {loadError && <p className="mt-1 font-mono text-xs">{loadError}</p>}
          </div>
        ) : (
          <>
            <header className="mb-8">
              <p className="text-sm uppercase tracking-widest text-ink-subtle">
                {customer.type === 'BUSINESS' ? 'Company' : 'Individual'}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-ink-strong">
                {customer.displayName}
              </h1>
              <p className="mt-2 text-ink-muted">{customer.email ?? 'No email on file'}</p>
              {customer.phone && <p className="text-ink-muted">{customer.phone}</p>}
            </header>

            <div className="mb-8 grid gap-6 sm:grid-cols-2">
              <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-ink-strong">Billing address</h2>
                <p className="text-sm text-ink-muted">
                  {formatAddress(customer.billingAddress) ?? 'Not on file'}
                </p>
              </section>
              <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-ink-strong">Shipping address</h2>
                <p className="text-sm text-ink-muted">
                  {formatAddress(customer.shippingAddress) ?? 'Same as billing address'}
                </p>
              </section>
            </div>

            <section className="rounded-lg border border-border bg-surface shadow-sm">
              <h2 className="border-b border-border px-5 py-4 text-sm font-semibold text-ink-strong">
                Invoices
              </h2>
              {invoices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center">
                  <ScrollText className="h-8 w-8 text-ink-subtle" aria-hidden />
                  <p className="text-sm text-ink-muted">No invoices for this customer yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Total</th>
                      <th className="px-5 py-3">Balance</th>
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
                          {formatMinorForDisplay(inv.totalMinor, toCurrencyCode(inv.currency))}
                        </td>
                        <td className="px-5 py-3 font-mono text-ink-strong">
                          {formatMinorForDisplay(inv.balanceMinor, toCurrencyCode(inv.currency))}
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
