/**
 * The invoice PDF's HTML body (FR-PAY "Download PDF").
 *
 * Lives here rather than in the API for the same reason
 * email-receipt-html.ts does: it is pure, and the admin editor's live preview
 * (InvoicePreviewBody, apps/admin/.../invoice-pdf-editor.tsx) is written
 * against the same three layouts — a layout added here is a layout that
 * preview must grow too. This file is rendered by a real headless browser
 * (see apps/api's InvoicePdfService), not an email client, so — unlike
 * email-receipt-html.ts — it is free to use a real <style> block, flexbox and
 * grid rather than table-based markup with inline styles throughout.
 *
 * Every visible element here has a counterpart in InvoicePreviewBody: the
 * Classic/Modern/Minimal header treatments, the "Bill To" / dates row, the
 * numbered line-item table, each layout's own totals treatment, and the
 * notes block. A change to one is a change to both — a merchant configuring
 * Brand Settings reads the preview as a promise about the PDF a customer
 * actually receives.
 */

export type InvoicePdfLayout = 'CLASSIC' | 'MODERN' | 'MINIMAL';

export interface InvoicePdfHtmlInput {
  readonly number: string;
  /** ISO date strings (yyyy-mm-dd) — formatted here the same way the admin
   * preview's own loadInvoicePdfPreview does, via formatDateForDisplay. */
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly brand: {
    readonly displayName: string;
    readonly themeColor: string;
    /** Signed URL or null — null falls back to the company's first initial
     * on a theme-coloured disc, exactly as the editor's preview does. */
    readonly logoUrl: string | null;
  };
  readonly customerName: string;
  /** Multi-line (newline-separated), possibly empty. */
  readonly customerAddress: string;
  readonly settings: {
    readonly invoicePdfLayout: InvoicePdfLayout;
    readonly companyName: string;
    readonly companyAddress: string;
    readonly showCompanyAddress: boolean;
    readonly showPaymentTerms: boolean;
    readonly showNotes: boolean;
    readonly paymentTerms: 'DUE_ON_RECEIPT' | 'NET_15' | 'NET_30' | 'NET_60';
    readonly notes: string;
  };
  readonly lines: ReadonlyArray<{
    readonly itemName: string;
    /** Already formatted for display (e.g. "20"), same convention as the
     * admin preview's InvoicePdfPreviewInvoice.lineItems. */
    readonly quantityLabel: string;
    readonly rateLabel: string;
    readonly amountLabel: string;
  }>;
  readonly subtotalLabel: string;
  readonly totalLabel: string;
  readonly balanceDueLabel: string;
}

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK_STRONG = '#0A0A0C';
const INK_MUTED = '#6B7280';
const INK_SUBTLE = '#8C919B';
const SURFACE_MUTED = '#F5F5F6';

const PAYMENT_TERMS_LABELS: Record<InvoicePdfHtmlInput['settings']['paymentTerms'], string> = {
  DUE_ON_RECEIPT: 'Due on receipt',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
};

export function renderInvoicePdfHtml(input: InvoicePdfHtmlInput): string {
  const { settings } = input;
  const body =
    settings.invoicePdfLayout === 'MODERN'
      ? modernBody(input)
      : settings.invoicePdfLayout === 'MINIMAL'
        ? minimalBody(input)
        : classicBody(input);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ${FONT_STACK}; color: ${INK_STRONG}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      table { border-collapse: collapse; width: 100%; }
      .muted { color: ${INK_MUTED}; }
      .subtle { color: ${INK_SUBTLE}; }
      .bill-to-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; font-size: 14px; }
      .dates { text-align: right; font-size: 14px; line-height: 1.6; }
      .items { margin-top: 24px; font-size: 14px; }
      .items thead tr { background: #E7EDF5; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #000000; }
      .items th, .items td { padding: 10px 0; }
      .items th:first-child, .items td:first-child { width: 40px; padding-left: 16px; }
      .items th:last-child, .items td:last-child { text-align: right; padding-right: 16px; }
      .items tbody tr { border-bottom: 1px solid #F1F5F9; }
      .items tbody td:first-child { color: ${INK_MUTED}; }
      .notes { margin-top: 24px; border-top: 1px solid #E5E7EB; padding-top: 16px; }
      .notes p:first-child { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: ${INK_SUBTLE}; }
      .notes p:last-child { margin: 4px 0 0; font-size: 12px; color: ${INK_MUTED}; white-space: pre-line; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function logoMark(input: InvoicePdfHtmlInput, size: number, border: string): string {
  const { brand, settings } = input;
  if (brand.logoUrl) {
    return `<img src="${escapeHtml(brand.logoUrl)}" alt="" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border-radius:${size}px;object-fit:cover;${border}" />`;
  }
  const initial = escapeHtml(initialOf(settings.companyName));
  return `<div style="width:${size}px;height:${size}px;border-radius:${size}px;background:${escapeHtml(brand.themeColor)};color:#FFFFFF;font-size:${Math.round(size / 2.5)}px;font-weight:700;display:flex;align-items:center;justify-content:center;${border}">${initial}</div>`;
}

function companyAddressBlock(input: InvoicePdfHtmlInput, style: string): string {
  const { settings } = input;
  if (!settings.showCompanyAddress || !settings.companyAddress) return '';
  return `<p style="margin:4px 0 0;white-space:pre-line;${style}">${escapeHtml(settings.companyAddress)}</p>`;
}

function billToAndDates(input: InvoicePdfHtmlInput): string {
  return `<div class="bill-to-row">
      <div>
        <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:${INK_SUBTLE};">Bill To</p>
        <p style="margin:4px 0 0;font-weight:600;">${escapeHtml(input.customerName)}</p>
        <p class="muted" style="margin:0;white-space:pre-line;">${escapeHtml(input.customerAddress)}</p>
      </div>
      <div class="dates">
        <p style="margin:0;"><span class="muted">Invoice date: </span><strong>${escapeHtml(input.invoiceDate)}</strong></p>
        ${
          input.settings.showPaymentTerms
            ? `<p style="margin:0;"><span class="muted">Terms: </span><strong>${escapeHtml(PAYMENT_TERMS_LABELS[input.settings.paymentTerms])}</strong></p>`
            : ''
        }
        <p style="margin:0;"><span class="muted">Due date: </span><strong>${escapeHtml(input.dueDate)}</strong></p>
      </div>
    </div>`;
}

function itemsTable(input: InvoicePdfHtmlInput): string {
  const rows = input.lines
    .map(
      (line, index) => `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(line.itemName)}</td>
          <td class="muted">${escapeHtml(line.quantityLabel)}</td>
          <td class="muted">${escapeHtml(line.rateLabel)}</td>
          <td>${escapeHtml(line.amountLabel)}</td>
        </tr>`,
    )
    .join('\n');

  return `<table class="items">
      <thead><tr><th>#</th><th>Item &amp; Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Modern boxes its totals in a bordered card with a shaded Balance Due row;
 * Classic and Minimal share plain stacked lines with a bold rule between
 * Total and Balance Due — two genuinely different treatments, matching
 * InvoicePreviewBody's own `totals` branch exactly. */
function totalsBlock(input: InvoicePdfHtmlInput): string {
  if (input.settings.invoicePdfLayout === 'MODERN') {
    return `<div style="margin-top:24px;display:flex;justify-content:flex-end;">
        <div style="width:256px;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;font-size:14px;">
          <div style="display:flex;justify-content:space-between;padding:10px 16px;"><span class="muted">Subtotal</span><span style="font-weight:600;">${escapeHtml(input.subtotalLabel)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 16px;border-top:1px solid #E5E7EB;font-weight:700;"><span>Total</span><span>${escapeHtml(input.totalLabel)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 16px;background:${SURFACE_MUTED};font-weight:700;"><span>Balance Due</span><span>${escapeHtml(input.balanceDueLabel)}</span></div>
        </div>
      </div>`;
  }

  return `<div style="margin-top:24px;display:flex;justify-content:flex-end;">
      <div style="width:240px;font-size:14px;">
        <div style="display:flex;justify-content:space-between;"><span class="muted">Subtotal</span><span style="font-weight:600;">${escapeHtml(input.subtotalLabel)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid #E5E7EB;font-weight:700;"><span>Total</span><span>${escapeHtml(input.totalLabel)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:2px solid ${INK_STRONG};font-weight:700;"><span>Balance Due</span><span>${escapeHtml(input.balanceDueLabel)}</span></div>
      </div>
    </div>`;
}

function notesBlock(input: InvoicePdfHtmlInput): string {
  if (!input.settings.showNotes || !input.settings.notes) return '';
  return `<div class="notes"><p>Notes</p><p>${escapeHtml(input.settings.notes)}</p></div>`;
}

function modernBody(input: InvoicePdfHtmlInput): string {
  const theme = escapeHtml(input.brand.themeColor);
  return `<div style="background:${theme};padding:24px 32px;color:#FFFFFF;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          ${logoMark(input, 50, 'border:2px solid #FFFFFF;')}
          <div>
            <p style="margin:0;font-weight:700;">${escapeHtml(input.settings.companyName)}</p>
            ${companyAddressBlock(input, 'font-size:12px;color:rgba(255,255,255,0.8);')}
          </div>
        </div>
        <div style="text-align:right;">
          <p style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.03em;color:rgba(255,255,255,0.7);">Invoice</p>
          <p style="margin:4px 0 0;font-size:24px;font-weight:700;">#${escapeHtml(input.number)}</p>
          <p style="margin:8px 0 0;font-size:14px;font-weight:700;">Balance due: ${escapeHtml(input.balanceDueLabel)}</p>
        </div>
      </div>
    </div>
    <div style="padding:32px;">
      ${billToAndDates(input)}
      ${itemsTable(input)}
      ${totalsBlock(input)}
      ${notesBlock(input)}
    </div>`;
}

function minimalBody(input: InvoicePdfHtmlInput): string {
  const theme = escapeHtml(input.brand.themeColor);
  return `<div style="padding:32px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid #E5E7EB;padding-bottom:24px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          ${logoMark(input, 50, 'border:1px solid #E5E5E5;')}
          <div>
            <p style="margin:0;font-size:18px;font-weight:700;">${escapeHtml(input.settings.companyName)}</p>
            ${companyAddressBlock(input, 'font-size:12px;')}
          </div>
        </div>
        <div style="text-align:right;">
          <p class="subtle" style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.03em;">Invoice</p>
          <p style="margin:4px 0 0;font-size:24px;font-weight:700;">#${escapeHtml(input.number)}</p>
        </div>
      </div>
      <div style="margin-top:24px;display:flex;align-items:stretch;gap:12px;">
        <div style="width:4px;border-radius:2px;background:${theme};"></div>
        <div>
          <p class="muted" style="margin:0;font-size:14px;">Balance due</p>
          <p style="margin:0;font-size:30px;font-weight:700;">${escapeHtml(input.balanceDueLabel)}</p>
        </div>
      </div>
      <div style="margin-top:24px;">
        ${billToAndDates(input)}
      </div>
      ${itemsTable(input)}
      ${totalsBlock(input)}
      ${notesBlock(input)}
    </div>`;
}

function classicBody(input: InvoicePdfHtmlInput): string {
  const theme = escapeHtml(input.brand.themeColor);
  return `<div style="padding:32px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid #F3F4F6;padding-bottom:24px;">
        <div>
          ${logoMark(input, 60, 'border:1px solid #E5E5E5;')}
          <p style="margin:16px 0 0;font-size:20px;font-weight:700;">${escapeHtml(input.settings.companyName)}</p>
          ${companyAddressBlock(input, 'font-size:14px;max-width:220px;')}
        </div>
        <div style="text-align:right;">
          <p style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.05em;">INVOICE</p>
          <p class="muted" style="margin:4px 0 0;font-size:14px;"># ${escapeHtml(input.number)}</p>
          <span style="display:inline-block;margin-top:12px;border-radius:9999px;padding:8px 16px;font-size:13px;font-weight:700;color:#FFFFFF;background:${theme};">Balance due: ${escapeHtml(input.balanceDueLabel)}</span>
        </div>
      </div>
      <div style="margin-top:24px;">
        ${billToAndDates(input)}
      </div>
      ${itemsTable(input)}
      ${totalsBlock(input)}
      ${notesBlock(input)}
    </div>
    <div style="height:8px;background:${theme};"></div>`;
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
