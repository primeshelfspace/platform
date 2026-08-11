import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { PublicInvoice } from '@/lib/invoice';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** Logo image if the brand has one, otherwise its initial on a solid circle —
 * same fallback the admin's Payment Page editor previews. */
function Avatar({
  brand,
  size,
  fallbackBackground,
}: {
  brand: PublicInvoice['brand'];
  size: 'sm' | 'lg';
  /** Only used when there's no logo image; a light overlay reads on the
   * Banner strip, the theme colour itself reads on a plain surface. */
  fallbackBackground: string;
}) {
  const dimension = size === 'lg' ? 'h-16 w-16' : 'h-10 w-10';
  return (
    <span
      className={`flex ${dimension} shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-bold text-white`}
      style={{ backgroundColor: brand.logoUrl ? undefined : fallbackBackground }}
    >
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialOf(brand.displayName)
      )}
    </span>
  );
}

/** Amount due + due date — identical content in every layout, just placed
 * differently around it. */
function InvoiceSummary({ invoice, centered }: { invoice: PublicInvoice; centered?: boolean }) {
  return (
    <div className={centered ? 'text-center' : ''}>
      <h1 className="text-lg font-medium text-ink-strong">Invoice {invoice.number}</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className={`flex items-baseline gap-2 ${centered ? 'justify-center' : 'justify-between'}`}>
          <dt className="text-ink-muted">Amount due</dt>
          <dd className="font-medium text-ink-strong">
            {formatMinorForDisplay(invoice.balanceMinor, toCurrencyCode(invoice.currency))}
          </dd>
        </div>
        <div className={`flex items-baseline gap-2 ${centered ? 'justify-center' : 'justify-between'}`}>
          <dt className="text-ink-muted">Due</dt>
          <dd className="text-ink-strong">{invoice.dueDate}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The real hosted payment page's brand chrome — Brand Settings > Branding >
 * Payment Page's `paymentPageLayout` decides which of these three a customer
 * actually sees. `children` is the live payment form (or a settled/terminal
 * message); this component only ever arranges brand identity and invoice
 * numbers around it, never fabricates either.
 */
export function PaymentPageShell({
  invoice,
  children,
}: {
  invoice: PublicInvoice;
  children: React.ReactNode;
}) {
  const themeColor = invoice.brand.themeColor;

  if (invoice.paymentPageLayout === 'SPLIT') {
    return (
      <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="grid gap-8 rounded-lg border border-border bg-surface p-8 shadow-sm sm:grid-cols-2">
          <div>
            <div
              style={{ backgroundColor: themeColor }}
              className="rounded-xl px-4 py-5 text-center"
            >
              <div className="mx-auto flex justify-center">
                <Avatar brand={invoice.brand} size="sm" fallbackBackground="rgba(255,255,255,0.2)" />
              </div>
              <span className="mt-2 block text-sm font-bold text-white">
                {invoice.brand.displayName}
              </span>
            </div>
            <div className="mt-6">
              <InvoiceSummary invoice={invoice} />
            </div>
          </div>
          <div>{children}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        {invoice.paymentPageLayout === 'BANNER' ? (
          <div
            style={{ backgroundColor: themeColor }}
            className="flex items-center gap-4 px-6 py-8"
          >
            <Avatar brand={invoice.brand} size="lg" fallbackBackground="rgba(255,255,255,0.2)" />
            <span className="text-2xl font-bold text-white">{invoice.brand.displayName}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 pt-8">
            <Avatar brand={invoice.brand} size="lg" fallbackBackground={themeColor} />
            <span className="text-lg font-bold text-ink-strong">{invoice.brand.displayName}</span>
          </div>
        )}

        <div className="p-8">
          <InvoiceSummary invoice={invoice} centered={invoice.paymentPageLayout === 'CENTERED'} />
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
