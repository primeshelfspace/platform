import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { PublicInvoice, PublicInvoicePdfSettings } from '@/lib/invoice';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

const PAYMENT_TERMS_LABEL: Record<PublicInvoicePdfSettings['paymentTerms'], string> = {
  DUE_ON_RECEIPT: 'Due on receipt',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
};

interface DocumentLineItem {
  description: string;
  quantityLabel: string;
  rateLabel: string;
  amountLabel: string;
}

interface DocumentInvoice {
  number: string;
  customerName: string;
  customerAddress: string;
  invoiceDateLabel: string;
  dueDateLabel: string;
  lineItems: readonly DocumentLineItem[];
  subtotalLabel: string;
  totalLabel: string;
  balanceDueLabel: string;
}

/**
 * This is a deliberate, near-verbatim port of InvoicePreviewBody
 * (apps/admin/.../brand-settings/invoice-pdf-editor.tsx) — same markup,
 * same class names, same three-layout branching, same physical size
 * (a 744px-wide card). The admin component previews a brand's settings
 * against a sample or the brand's latest invoice; this one renders a real
 * invoice for the customer who was actually sent it, at the exact same
 * fidelity a merchant configured and saw in that preview.
 *
 * Duplicated rather than shared across the two apps — same reasoning
 * CollapseToggle/ColourField already accept in the admin editors themselves
 * (see their own comments): keeping each independently safe to change beats
 * a cross-app dependency for one presentational component. If the two drift,
 * that is a sign this pair needs revisiting together, not evidence the
 * duplication itself was wrong.
 *
 * Deliberately does NOT render a tax line in the totals block, even though
 * showTaxBreakdown/taxLabel exist — the admin's own InvoicePreviewBody has
 * never rendered one either (Subtotal/Total/Balance Due only). Replicating
 * that gap exactly is what makes this "exact as saved", not a place to
 * fix it unilaterally and end up subtly different from what the merchant
 * actually previewed and approved.
 */
function InvoicePreviewBody({
  layout,
  themeColor,
  logoSrc,
  companyName,
  companyAddress,
  showCompanyAddress,
  showPaymentTerms,
  showNotes,
  paymentTerms,
  notes,
  invoice,
}: {
  layout: PublicInvoicePdfSettings['invoicePdfLayout'];
  themeColor: string;
  logoSrc: string | null;
  companyName: string;
  companyAddress: string;
  showCompanyAddress: boolean;
  showPaymentTerms: boolean;
  showNotes: boolean;
  paymentTerms: PublicInvoicePdfSettings['paymentTerms'];
  notes: string;
  invoice: DocumentInvoice;
}) {
  const logo = (
    <span
      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white text-sm font-bold"
      style={{ backgroundColor: logoSrc ? undefined : 'rgba(255,255,255,0.2)' }}
      aria-hidden
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        initialOf(companyName)
      )}
    </span>
  );

  const dateRows = (
    <div className="space-y-1 text-right text-sm">
      <p>
        <span className="text-ink-muted">Invoice date: </span>
        <span className="font-bold text-ink-strong">{invoice.invoiceDateLabel}</span>
      </p>
      {showPaymentTerms && (
        <p>
          <span className="text-ink-muted">Terms: </span>
          <span className="font-bold text-ink-strong">{PAYMENT_TERMS_LABEL[paymentTerms]}</span>
        </p>
      )}
      <p>
        <span className="text-ink-muted">Due date: </span>
        <span className="font-bold text-ink-strong">{invoice.dueDateLabel}</span>
      </p>
    </div>
  );

  const decorated = true;
  const table = (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr
          className={`text-left text-xs font-bold uppercase tracking-wide text-black ${
            decorated ? 'bg-[#E7EDF5]' : 'border-b border-[#E5E7EB]'
          }`}
        >
          {decorated && <th className="w-10 py-2 pl-4">#</th>}
          <th className="py-2">Item &amp; Description</th>
          <th className="py-2">Qty</th>
          <th className="py-2">Rate</th>
          <th className={`py-2 text-right ${decorated ? 'pr-4' : ''}`}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {invoice.lineItems.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-[#F1F5F9]">
            {decorated && <td className="py-3 pl-4 text-ink-muted">{index + 1}</td>}
            <td className="py-3 text-ink-strong">{line.description}</td>
            <td className="py-3 text-ink-muted">{line.quantityLabel}</td>
            <td className="py-3 text-ink-muted">{line.rateLabel}</td>
            <td className={`py-3 text-right text-ink-strong ${decorated ? 'pr-4' : ''}`}>
              {line.amountLabel}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const totals =
    layout === 'MODERN' ? (
      <div className="mt-6 flex justify-end">
        <div className="w-64 overflow-hidden rounded-lg border border-[#E5E7EB] text-sm">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-ink-muted">Subtotal</span>
            <span className="font-medium text-ink-strong">{invoice.subtotalLabel}</span>
          </div>
          <div className="flex justify-between border-t border-[#E5E7EB] px-4 py-2.5 font-bold text-ink-strong">
            <span>Total</span>
            <span>{invoice.totalLabel}</span>
          </div>
          <div className="flex justify-between bg-surface-muted px-4 py-2.5 font-bold text-ink-strong">
            <span>Balance Due</span>
            <span>{invoice.balanceDueLabel}</span>
          </div>
        </div>
      </div>
    ) : (
      <div className="mt-6 flex justify-end">
        <div className="w-60 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span className="font-medium text-ink-strong">{invoice.subtotalLabel}</span>
          </div>
          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5 font-bold text-ink-strong">
            <span>Total</span>
            <span>{invoice.totalLabel}</span>
          </div>
          <div className="flex justify-between border-t-2 border-ink-strong pt-1.5 font-bold text-ink-strong">
            <span>Balance Due</span>
            <span>{invoice.balanceDueLabel}</span>
          </div>
        </div>
      </div>
    );

  const notesBlock = showNotes && (
    <div className="mt-6 border-t border-[#E5E7EB] pt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Notes</p>
      <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{notes}</p>
    </div>
  );

  if (layout === 'MODERN') {
    return (
      <div>
        <div className="p-6" style={{ backgroundColor: themeColor }}>
          <div className="flex items-start justify-between gap-4 text-white">
            <div className="flex items-start gap-3">
              {logo}
              <div>
                <p className="font-bold">{companyName}</p>
                {showCompanyAddress && companyAddress && (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-white/80">
                    {companyAddress}
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm uppercase tracking-wide text-white/70">Invoice</p>
              <p className="mt-1 text-2xl font-bold text-white">#{invoice.number}</p>
              <p className="mt-2 text-sm font-bold text-white">
                Balance due: {invoice.balanceDueLabel}
              </p>
            </div>
          </div>
        </div>
        <div className="p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
              <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
              <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
            </div>
            {dateRows}
          </div>
          {table}
          {totals}
          {notesBlock}
        </div>
      </div>
    );
  }

  if (layout === 'MINIMAL') {
    return (
      <div className="p-8">
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-6">
          <div className="flex items-start gap-3">
            <span
              className="flex h-[59px] w-[59px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E5E5E5] text-lg font-bold text-white"
              style={{ backgroundColor: logoSrc ? undefined : themeColor }}
              aria-hidden
            >
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                initialOf(companyName)
              )}
            </span>
            <div>
              <p className="text-lg font-bold text-ink-strong">{companyName}</p>
              {showCompanyAddress && companyAddress && (
                <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{companyAddress}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm uppercase tracking-wide text-ink-subtle">Invoice</p>
            <p className="mt-1 text-2xl font-bold text-ink-strong">#{invoice.number}</p>
          </div>
        </div>
        <div className="mt-6 flex items-stretch gap-3">
          <div className="w-1 shrink-0 rounded-full" style={{ backgroundColor: themeColor }} />
          <div>
            <p className="text-sm text-ink-muted">Balance due</p>
            <p className="text-3xl font-bold text-ink-strong">{invoice.balanceDueLabel}</p>
          </div>
        </div>
        <div className="mt-6 flex items-start justify-between gap-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
            <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
            <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
          </div>
          {dateRows}
        </div>
        {table}
        {totals}
        {notesBlock}
      </div>
    );
  }

  // CLASSIC
  return (
    <div>
      <div className="p-8">
        <div className="flex items-start justify-between gap-4 border-b border-[#F3F4F6] pb-6">
          <div>
            <span
              className="flex h-[59px] w-[59px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E5E5E5] text-lg font-bold text-white"
              style={{ backgroundColor: logoSrc ? undefined : themeColor }}
              aria-hidden
            >
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                initialOf(companyName)
              )}
            </span>
            <p className="mt-4 text-xl font-bold text-ink-strong">{companyName}</p>
            {showCompanyAddress && companyAddress && (
              <p className="mt-1 max-w-[220px] whitespace-pre-line text-sm text-ink-muted">
                {companyAddress}
              </p>
            )}
          </div>
          <div className="text-right">
            <svg
              viewBox="0 0 125 24"
              height={20}
              style={{ transform: 'rotate(0deg)', opacity: 1 }}
              className="ml-auto w-auto"
              fill="none"
              role="img"
              aria-label="Invoice"
            >
              <path
                d="M-0.000468761 22.71V0.359959H4.64953V22.71H-0.000468761ZM8.61281 22.71V0.359959H12.1828L24.1828 16.17L22.2628 16.62V0.359959H26.9128V22.71H23.3128L11.5228 6.77996L13.2628 6.32996V22.71H8.61281ZM36.8784 22.71L29.2284 0.359959H34.3284L40.0884 18.3H39.0684L44.8284 0.359959H49.9284L42.2784 22.71H36.8784ZM62.8399 23.07C61.1599 23.07 59.5999 22.78 58.1599 22.2C56.7199 21.62 55.4599 20.81 54.3799 19.77C53.3199 18.71 52.4899 17.48 51.8899 16.08C51.2899 14.68 50.9899 13.16 50.9899 11.52C50.9899 9.87996 51.2799 8.35996 51.8599 6.95996C52.4599 5.55996 53.2899 4.33996 54.3499 3.29996C55.4299 2.25996 56.6899 1.44996 58.1299 0.86996C59.5699 0.28996 61.1399 -3.99351e-05 62.8399 -3.99351e-05C64.5399 -3.99351e-05 66.1099 0.28996 67.5499 0.86996C68.9899 1.44996 70.2399 2.25996 71.2999 3.29996C72.3799 4.33996 73.2099 5.55996 73.7899 6.95996C74.3899 8.35996 74.6899 9.87996 74.6899 11.52C74.6899 13.16 74.3899 14.68 73.7899 16.08C73.1899 17.48 72.3499 18.71 71.2699 19.77C70.2099 20.81 68.9599 21.62 67.5199 22.2C66.0799 22.78 64.5199 23.07 62.8399 23.07ZM62.8399 18.87C63.8599 18.87 64.7999 18.69 65.6599 18.33C66.5399 17.97 67.3099 17.47 67.9699 16.83C68.6299 16.17 69.1399 15.39 69.4999 14.49C69.8599 13.59 70.0399 12.6 70.0399 11.52C70.0399 10.44 69.8599 9.45996 69.4999 8.57996C69.1399 7.67996 68.6299 6.89996 67.9699 6.23996C67.3099 5.57996 66.5399 5.07996 65.6599 4.73996C64.7999 4.37996 63.8599 4.19996 62.8399 4.19996C61.8199 4.19996 60.8699 4.37996 59.9899 4.73996C59.1299 5.07996 58.3699 5.57996 57.7099 6.23996C57.0499 6.89996 56.5399 7.67996 56.1799 8.57996C55.8199 9.45996 55.6399 10.44 55.6399 11.52C55.6399 12.6 55.8199 13.59 56.1799 14.49C56.5399 15.39 57.0499 16.17 57.7099 16.83C58.3699 17.47 59.1299 17.97 59.9899 18.33C60.8699 18.69 61.8199 18.87 62.8399 18.87ZM77.9878 22.71V0.359959H82.6378V22.71H77.9878ZM97.2211 23.07C95.6211 23.07 94.1311 22.78 92.7511 22.2C91.3911 21.62 90.2011 20.81 89.1811 19.77C88.1611 18.73 87.3611 17.51 86.7811 16.11C86.2211 14.71 85.9411 13.18 85.9411 11.52C85.9411 9.85996 86.2211 8.32996 86.7811 6.92996C87.3411 5.50996 88.1311 4.28996 89.1511 3.26996C90.1711 2.22996 91.3611 1.42996 92.7211 0.86996C94.1011 0.28996 95.6011 -3.99351e-05 97.2211 -3.99351e-05C98.8411 -3.99351e-05 100.291 0.26996 101.571 0.80996C102.871 1.34996 103.971 2.06996 104.871 2.96996C105.771 3.86996 106.411 4.86996 106.791 5.96996L102.681 7.94996C102.301 6.86996 101.631 5.97996 100.671 5.27996C99.7311 4.55996 98.5811 4.19996 97.2211 4.19996C95.9011 4.19996 94.7411 4.50996 93.7411 5.12996C92.7411 5.74996 91.9611 6.60996 91.4011 7.70996C90.8611 8.78996 90.5911 10.06 90.5911 11.52C90.5911 12.98 90.8611 14.26 91.4011 15.36C91.9611 16.46 92.7411 17.32 93.7411 17.94C94.7411 18.56 95.9011 18.87 97.2211 18.87C98.5811 18.87 99.7311 18.52 100.671 17.82C101.631 17.1 102.301 16.2 102.681 15.12L106.791 17.1C106.411 18.2 105.771 19.2 104.871 20.1C103.971 21 102.871 21.72 101.571 22.26C100.291 22.8 98.8411 23.07 97.2211 23.07ZM109.775 22.71V0.359959H124.805V4.40996H114.425V9.47996H124.205V13.53H114.425V18.66H124.805V22.71H109.775Z"
                fill="#101828"
              />
            </svg>
            <p className="mt-1 text-base text-ink-muted"># {invoice.number}</p>
            <span
              className="mt-3 inline-block rounded-full px-4 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: themeColor }}
            >
              Balance due: {invoice.balanceDueLabel}
            </span>
          </div>
        </div>
        <div className="mt-6 flex items-start justify-between gap-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
            <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
            <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
          </div>
          {dateRows}
        </div>
        {table}
        {totals}
        {notesBlock}
      </div>
      <div className="h-2" style={{ backgroundColor: themeColor }} aria-hidden />
    </div>
  );
}

/**
 * The public invoice page's entire content — the invoice document alone,
 * rendered at the exact size and fidelity of the admin's own Invoice PDF
 * preview (a 744px-wide document card, not a condensed summary), centred on
 * the page. There is no payment flow here (removed at the user's request);
 * this is a view-only link.
 */
export function InvoiceDocument({ invoice }: { invoice: PublicInvoice }) {
  const currency = toCurrencyCode(invoice.currency);
  const pdf = invoice.invoicePdf;
  const money = (minor: number) => formatMinorForDisplay(minor, currency);

  const documentInvoice: DocumentInvoice = {
    number: invoice.number,
    customerName: invoice.customerName,
    customerAddress: invoice.customerAddress,
    invoiceDateLabel: formatDateForDisplay(invoice.invoiceDate),
    dueDateLabel: formatDateForDisplay(invoice.dueDate),
    lineItems: invoice.lines.map((line) => ({
      description: line.itemName,
      quantityLabel: line.quantity,
      rateLabel: money(line.unitPriceMinor),
      amountLabel: money(line.lineTotalMinor),
    })),
    subtotalLabel: money(invoice.subtotalMinor),
    totalLabel: money(invoice.totalMinor),
    balanceDueLabel: money(invoice.balanceMinor),
  };

  return (
    <main className="mx-auto flex min-h-full w-[744px] max-w-full flex-col justify-center px-6 py-16">
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <InvoicePreviewBody
          layout={pdf.invoicePdfLayout}
          themeColor={invoice.brand.themeColor}
          logoSrc={invoice.brand.logoUrl}
          companyName={pdf.companyName}
          companyAddress={pdf.companyAddress}
          showCompanyAddress={pdf.showCompanyAddress}
          showPaymentTerms={pdf.showPaymentTerms}
          showNotes={pdf.showNotes}
          paymentTerms={pdf.paymentTerms}
          notes={pdf.notes}
          invoice={documentInvoice}
        />
      </div>
    </main>
  );
}
