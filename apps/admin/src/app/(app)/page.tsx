import Link from 'next/link';
import { CircleCheck, CircleDashed, ScrollText, Users, Wallet } from 'lucide-react';
import { formatMinorForDisplay } from '@fenwick/shared/money';
import { BrandTheme } from '@/components/brand-theme';
import {
  ApiError,
  getZohoStatus,
  listBrands,
  listCustomers,
  getInvoiceSummary,
  listInvoices,
  type Brand,
  type Invoice,
} from '@/lib/api';
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoice-presentation';

export const dynamic = 'force-dynamic';

const FALLBACK_THEME_COLOUR = '#16261F';

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-ink-muted">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-ink-strong">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:border-brand-ink">
      {content}
    </Link>
  ) : (
    content
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; brandCreated?: string }>;
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

  let customerTotal = 0;
  let invoices: Invoice[] = [];
  let customerNames = new Map<string, string>();
  let zohoConnected = false;
  // Aggregated server-side: summing the current page would silently report
  // only what happens to be on it.
  let outstandingMinor = 0;
  let dataError: string | null = null;

  if (activeBrand) {
    try {
      const [customersResult, invoicesResult, invoiceSummary, zohoStatus] = await Promise.all([
        listCustomers(activeBrand.id),
        listInvoices(activeBrand.id, { pageSize: 5 }),
        getInvoiceSummary(activeBrand.id),
        getZohoStatus(activeBrand.id).catch(() => ({
          connected: false,
          organizationName: null,
          lastSyncAt: null,
          health: null,
        })),
      ]);
      customerTotal = customersResult.total;
      invoices = invoicesResult.data;
      outstandingMinor = invoiceSummary.outstandingMinor;
      customerNames = new Map(customersResult.data.map((c) => [c.id, c.displayName]));
      zohoConnected = zohoStatus.connected;
    } catch (cause) {
      dataError = cause instanceof ApiError ? cause.message : String(cause);
    }
  }

  const currency = (activeBrand?.currency ?? 'USD') as 'USD';
  const recentInvoices = invoices;

  return (
    <BrandTheme brandColour={activeBrand?.themeColor ?? FALLBACK_THEME_COLOUR}>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-ink-subtle">
            {activeBrand ? activeBrand.displayName : 'Fenwick Holdings Inc.'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">Dashboard</h1>
        </header>

        {params.brandCreated && (
          <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
            Brand created.
          </div>
        )}

        {brandsError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load brands: {brandsError}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm text-ink-muted">No brands exist yet.</p>
            <Link
              href="/brands/structure"
              className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
            >
              Create your first brand
            </Link>
          </div>
        ) : dataError ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            Could not load dashboard data: {dataError}
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={Wallet}
                label="Outstanding balance"
                value={formatMinorForDisplay(outstandingMinor, currency)}
                href={`/invoices?brandId=${activeBrand!.id}`}
              />
              <StatCard
                icon={Users}
                label="Customers"
                value={String(customerTotal)}
                href={`/customers?brandId=${activeBrand!.id}`}
              />
              <StatCard
                icon={zohoConnected ? CircleCheck : CircleDashed}
                label="Zoho Books"
                value={zohoConnected ? 'Connected' : 'Not connected'}
                href={`/settings/integrations?brandId=${activeBrand!.id}`}
              />
            </div>

            <section className="rounded-lg border border-border bg-surface shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h2 className="font-medium text-ink-strong">Recent invoices</h2>
                <Link
                  href={`/invoices?brandId=${activeBrand!.id}`}
                  className="text-sm text-brand-ink underline"
                >
                  View all
                </Link>
              </div>

              {recentInvoices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center">
                  <ScrollText className="h-8 w-8 text-ink-subtle" aria-hidden />
                  <p className="font-medium text-ink-strong">No invoices yet</p>
                  <p className="text-sm text-ink-muted">
                    Create the first invoice for {activeBrand!.displayName}.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Customer</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 font-medium text-ink-strong">{inv.number}</td>
                        <td className="px-5 py-3 text-ink-muted">
                          {customerNames.get(inv.customerId) ?? '—'}
                        </td>
                        <td className={`px-5 py-3 font-medium ${invoiceStatusTone(inv.status)}`}>
                          {invoiceStatusLabel(inv.status)}
                        </td>
                        <td className="px-5 py-3 font-mono text-ink-strong">
                          {formatMinorForDisplay(inv.balanceMinor, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </BrandTheme>
  );
}
