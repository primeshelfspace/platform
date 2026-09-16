import { describe, expect, it } from 'vitest';
import { renderInvoicePdfHtml, type InvoicePdfHtmlInput } from './invoice-pdf-html.js';

const base: InvoicePdfHtmlInput = {
  number: 'INV-0042',
  invoiceDate: 'Jun 30, 2026',
  dueDate: 'Jul 30, 2026',
  brand: {
    displayName: 'Cobalt Studio Supply',
    themeColor: '#2D6A6A',
    logoUrl: null,
  },
  customerName: 'Harborline Supply',
  customerAddress: '123 Dock St\nPortland, ME 04101',
  settings: {
    invoicePdfLayout: 'CLASSIC',
    companyName: 'Cobalt Studio Supply Inc.',
    companyAddress: '9 Foundry Row\nPortland, ME 04101',
    showCompanyAddress: true,
    showPaymentTerms: true,
    showNotes: true,
    paymentTerms: 'NET_30',
    notes: 'Thanks for your business!',
  },
  lines: [
    {
      itemName: 'Cast-iron cookware set',
      quantityLabel: '12',
      rateLabel: '$200.00',
      amountLabel: '$2,400.00',
    },
    {
      itemName: 'Ceramic bakeware bundle',
      quantityLabel: '6',
      rateLabel: '$120.00',
      amountLabel: '$720.00',
    },
  ],
  subtotalLabel: '$3,120.00',
  totalLabel: '$3,307.20',
  balanceDueLabel: '$3,307.20',
};

describe('renderInvoicePdfHtml', () => {
  it('wraps every layout in the same document shell', () => {
    const html = renderInvoicePdfHtml(base);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('</html>');
  });

  it('renders CLASSIC with an "INVOICE" mark and a theme-coloured footer bar', () => {
    const html = renderInvoicePdfHtml(base);
    expect(html).toContain('INVOICE');
    expect(html).toContain(`# ${base.number}`);
    expect(html).toContain('height:8px;background:#2D6A6A');
  });

  it('renders MODERN with a theme-coloured header band and a boxed totals card', () => {
    const html = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, invoicePdfLayout: 'MODERN' },
    });
    expect(html).toContain('background:#2D6A6A;padding:24px 32px;color:#FFFFFF;');
    expect(html).toContain('Balance due: $3,307.20');
    // MODERN's totals card, unlike CLASSIC/MINIMAL's plain stacked lines.
    expect(html).toContain('border:1px solid #E5E7EB;border-radius:8px;overflow:hidden');
    expect(html).toContain('background:#F5F5F6;font-weight:700;"><span>Balance Due</span>');
  });

  it('renders MINIMAL with a large balance-due callout and a theme-coloured rule', () => {
    const html = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, invoicePdfLayout: 'MINIMAL' },
    });
    expect(html).toContain('Balance due');
    expect(html).toContain('width:4px;border-radius:2px;background:#2D6A6A;');
    expect(html).not.toContain('INVOICE</p>');
  });

  it('renders the logo image when the brand has one, and an initials disc when it does not', () => {
    const withoutLogo = renderInvoicePdfHtml(base);
    expect(withoutLogo).toContain('background:#2D6A6A;color:#FFFFFF');
    expect(withoutLogo).toContain('>C<');
    expect(withoutLogo).not.toContain('<img');

    const withLogo = renderInvoicePdfHtml({
      ...base,
      brand: { ...base.brand, logoUrl: 'https://cdn.example.com/logo.png' },
    });
    expect(withLogo).toContain('<img src="https://cdn.example.com/logo.png"');
    expect(withLogo).not.toContain('>C<');
  });

  it('numbers every line item and lists its quantity, rate and amount', () => {
    const html = renderInvoicePdfHtml(base);
    expect(html).toContain('Cast-iron cookware set');
    expect(html).toContain('Ceramic bakeware bundle');
    expect(html).toContain('$2,400.00');
    expect(html).toContain('$720.00');
    // Row numbering is 1-based off the array index.
    expect(html).toMatch(/<td>1<\/td>[\s\S]*Cast-iron/);
    expect(html).toMatch(/<td>2<\/td>[\s\S]*Ceramic/);
  });

  it('shows the subtotal, total and balance due labels verbatim', () => {
    const html = renderInvoicePdfHtml(base);
    expect(html).toContain(base.subtotalLabel);
    expect(html).toContain(base.totalLabel);
    expect(html).toContain(base.balanceDueLabel);
  });

  it('maps every payment terms value to its label, and hides the row when the setting is off', () => {
    for (const [terms, label] of [
      ['DUE_ON_RECEIPT', 'Due on receipt'],
      ['NET_15', 'Net 15'],
      ['NET_30', 'Net 30'],
      ['NET_60', 'Net 60'],
    ] as const) {
      const html = renderInvoicePdfHtml({
        ...base,
        settings: { ...base.settings, paymentTerms: terms },
      });
      expect(html).toContain(label);
    }

    const hidden = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, showPaymentTerms: false },
    });
    expect(hidden).not.toContain('Terms:');
  });

  it('hides the company address block when the setting is off or the address is blank', () => {
    const shown = renderInvoicePdfHtml(base);
    expect(shown).toContain('9 Foundry Row');

    const toggledOff = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, showCompanyAddress: false },
    });
    expect(toggledOff).not.toContain('9 Foundry Row');

    const blank = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, companyAddress: '' },
    });
    expect(blank).not.toContain('9 Foundry Row');
  });

  it('hides the notes block when the setting is off or notes are blank, shows it otherwise', () => {
    const shown = renderInvoicePdfHtml(base);
    expect(shown).toContain('Thanks for your business!');
    expect(shown).toContain('<p>Notes</p>');

    const toggledOff = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, showNotes: false },
    });
    expect(toggledOff).not.toContain('<p>Notes</p>');

    const blank = renderInvoicePdfHtml({
      ...base,
      settings: { ...base.settings, notes: '' },
    });
    expect(blank).not.toContain('<p>Notes</p>');
  });

  it('escapes HTML-significant characters wherever untrusted text is interpolated', () => {
    const html = renderInvoicePdfHtml({
      ...base,
      customerName: 'Bob & Sons <Ltd> "Fixtures"',
      settings: { ...base.settings, notes: 'Ship < 5 days & confirm > "on arrival"' },
    });
    expect(html).toContain('Bob &amp; Sons &lt;Ltd&gt; &quot;Fixtures&quot;');
    expect(html).toContain('Ship &lt; 5 days &amp; confirm &gt; &quot;on arrival&quot;');
    expect(html).not.toContain('<Ltd>');
    expect(html).not.toContain('"Fixtures"');
  });
});
