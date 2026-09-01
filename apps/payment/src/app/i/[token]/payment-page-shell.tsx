import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { PublicInvoice } from '@/lib/invoice';
import { DownloadIcon } from './icons';

/**
 * The hosted payment page's brand chrome.
 *
 * This is the customer-facing counterpart of PreviewBody in the admin's
 * Payment Page editor (apps/admin/.../brand-settings/payment-page-editor.tsx),
 * and is written against it element for element: the same three layouts off
 * `paymentPageLayout`, the same banner/centered/split arrangements, the same
 * invoice summary block (number • customer, the amount at 3xl, the due date
 * with its orange emphasis) and the same accent-coloured actions. A merchant
 * reads that preview as a promise about what their customer sees, so a change
 * to one of the two is a change to both.
 *
 * `children` is the live payment form. This component only ever arranges
 * brand identity and invoice numbers around it, and never fabricates either.
 *
 * Where the editor's preview shows a "View Invoice" link, the real page shows
 * "Download invoice" — the same slot in the same design, pointing at the
 * invoice document route rather than back at itself.
 */
export function PaymentPageShell({
  invoice,
  token,
  children,
}: {
  invoice: PublicInvoice;
  token: string;
  children: React.ReactNode;
}) {
  const themeColor = invoice.brand.themeColor;
  const layout = invoice.paymentPageLayout;

  if (layout === 'SPLIT') {
    return (
      <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="grid overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm sm:grid-cols-2">
          <div style={{ backgroundColor: themeColor }} className="flex flex-col gap-6 p-6">
            <div className="flex items-center gap-3 border-b border-white/20 pb-5">
              <Avatar brand={invoice.brand} size="sm" fallbackBackground="rgba(255,255,255,0.2)" />
              <span className="text-lg font-bold text-white">{invoice.brand.displayName}</span>
            </div>
            <InvoiceSummary invoice={invoice} token={token} light />
          </div>
          <div className="p-6">{children}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        {layout === 'BANNER' ? (
          <div
            style={{ backgroundColor: themeColor }}
            className="flex items-center gap-4 px-6 py-8"
          >
            <Avatar brand={invoice.brand} size="lg" fallbackBackground="rgba(255,255,255,0.2)" />
            <span className="text-2xl font-bold text-white">{invoice.brand.displayName}</span>
          </div>
        ) : (
          // Centered: a short colour bar with the logo overlapping its bottom
          // edge and the name below — a cover-photo/profile-picture
          // arrangement, distinct from Banner's full-height row.
          <div className="flex flex-col items-center">
            <div style={{ backgroundColor: themeColor }} className="h-16 w-full" />
            <div className="-mt-8 rounded-full border-4 border-white shadow-sm">
              <Avatar brand={invoice.brand} size="lg" fallbackBackground={themeColor} />
            </div>
            <span className="mt-2 px-6 text-lg font-bold text-ink-strong">
              {invoice.brand.displayName}
            </span>
          </div>
        )}

        <div className="p-6">
          <InvoiceSummary invoice={invoice} token={token} centered={layout === 'CENTERED'} />
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** Logo image if the brand has one, otherwise its initial on a solid circle —
 * the same fallback the admin's Payment Page editor previews. */
function Avatar({
  brand,
  size,
  fallbackBackground,
}: {
  brand: PublicInvoice['brand'];
  size: 'sm' | 'lg';
  /** Only used when there is no logo image: a light overlay reads on the
   * Banner strip, the theme colour itself reads on a plain surface. */
  fallbackBackground: string;
}) {
  const dimension = size === 'lg' ? 'h-16 w-16 text-lg' : 'h-10 w-10 text-sm';
  return (
    <span
      className={`flex ${dimension} shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white`}
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

/**
 * Identical content in every layout, placed differently around it. `light`
 * renders white-on-colour for the Split layout's full-bleed brand panel,
 * where the default dark/orange palette would be unreadable.
 */
function InvoiceSummary({
  invoice,
  token,
  centered,
  light,
}: {
  invoice: PublicInvoice;
  token: string;
  centered?: boolean;
  light?: boolean;
}) {
  const amountLabel = formatMinorForDisplay(invoice.balanceMinor, toCurrencyCode(invoice.currency));

  return (
    <div className={centered ? 'text-center' : ''}>
      {light ? (
        <p className="text-base font-bold leading-snug text-white">
          <span className="block">Invoice {invoice.number}</span>
          <span className="block">{invoice.customerName}</span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Invoice {invoice.number} &bull; {invoice.customerName}
        </p>
      )}
      <p
        className={`${light ? 'mt-2' : 'mt-1'} text-3xl font-bold ${light ? 'text-white' : 'text-ink-strong'}`}
      >
        {amountLabel}
      </p>
      <div
        className={`flex text-sm ${light ? 'mt-4 gap-4 font-bold text-white' : 'mt-2 gap-3 text-ink-muted'} ${
          centered
            ? 'flex-col items-center'
            : light
              ? 'flex-col items-start'
              : 'items-center justify-between'
        }`}
      >
        <span>
          Due Date:{' '}
          <span className={light ? undefined : 'font-semibold text-orange-600'}>
            {formatDateForDisplay(invoice.dueDate)}
          </span>
        </span>
        <a
          href={`/i/${token}/invoice`}
          className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${
            light
              ? 'border-white bg-transparent px-4 py-2 text-sm text-white hover:bg-white/10'
              : 'border-blue-600 bg-white px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50'
          }`}
        >
          Download invoice
          <DownloadIcon className={light ? 'h-4 w-4' : 'h-3 w-3'} />
        </a>
      </div>
    </div>
  );
}
