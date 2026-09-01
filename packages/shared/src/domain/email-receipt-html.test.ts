import { describe, expect, it } from 'vitest';
import { renderEmailReceiptHtml, type EmailReceiptHtmlInput } from './email-receipt-html.js';

const base: EmailReceiptHtmlInput = {
  layout: 'CLASSIC',
  brandName: 'Cobalt Studio Supply',
  themeColor: '#2D6A6A',
  accentColor: '#CC0066',
  logoSrc: null,
  senderAddress: 'billing@cobalt.example',
  subject: 'New invoice from Cobalt Studio Supply',
  body: 'Hi Harborline,\n\nYour invoice is ready.',
  variables: { invoiceNumber: 'INV-3021', amountDue: '$4,820.00', dueDate: 'Aug 26, 2026' },
  linkUrl: 'https://pay.example.com/i/tok_123',
  termsUrl: 'https://admin.example.com/terms',
  privacyUrl: 'https://admin.example.com/privacy',
};

describe('renderEmailReceiptHtml', () => {
  it('paints the button with the accent colour, not a hardcoded one', () => {
    const html = renderEmailReceiptHtml(base);
    expect(html).toContain('background:#CC0066');
    expect(html).not.toContain('#171717');
  });

  it('fills the header with the brand colour on HERO', () => {
    const hero = renderEmailReceiptHtml({ ...base, layout: 'HERO' });
    expect(hero).toContain('background:#2D6A6A;padding:32px 24px;text-align:center;');
  });

  it('gives HERO and CLASSIC a colour band and MINIMAL none', () => {
    const band = `background:${base.themeColor};font-size:0`;
    expect(renderEmailReceiptHtml(base)).toContain(band);
    expect(renderEmailReceiptHtml({ ...base, layout: 'HERO' })).toContain(band);

    const minimal = renderEmailReceiptHtml({ ...base, layout: 'MINIMAL' });
    expect(minimal).not.toContain(band);
    // MINIMAL's colour is the short rule above the subject instead.
    expect(minimal).toContain('width:40px;height:6px');
  });

  it('renders the logo when there is one and the initial when there is not', () => {
    expect(renderEmailReceiptHtml(base)).toContain('>C</td>');
    const withLogo = renderEmailReceiptHtml({ ...base, logoSrc: 'cid:brand-logo' });
    expect(withLogo).toContain('src="cid:brand-logo"');
    expect(withLogo).not.toContain('>C</td>');
  });

  it('shows the subject in the body and every summary field', () => {
    const html = renderEmailReceiptHtml(base);
    expect(html).toContain('New invoice from Cobalt Studio Supply');
    expect(html).toContain('INV-3021');
    expect(html).toContain('$4,820.00');
    expect(html).toContain('Aug 26, 2026');
    expect(html).toContain('https://pay.example.com/i/tok_123');
  });

  it('turns blank lines into separate paragraphs', () => {
    const html = renderEmailReceiptHtml(base);
    expect(html).toContain('>Hi Harborline,</p>');
    expect(html).toContain('>Your invoice is ready.</p>');
  });

  it('escapes brand and body text rather than emitting it as markup', () => {
    const html = renderEmailReceiptHtml({
      ...base,
      brandName: 'A & B <script>alert(1)</script>',
      body: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('A &amp; B &lt;script&gt;');
  });

  it('lets the test send label the header without renaming the brand', () => {
    const html = renderEmailReceiptHtml({ ...base, badgeLabel: 'Test send' });
    expect(html).toContain('Test send');
    expect(html).toContain('>T</td>');
  });

  // The preview shows all four; before this they existed only there, so a
  // merchant approved a design their customer never received.

  it('shows the sender address under the brand name, on every layout', () => {
    for (const layout of ['CLASSIC', 'HERO', 'MINIMAL'] as const) {
      expect(renderEmailReceiptHtml({ ...base, layout })).toContain('billing@cobalt.example');
    }
  });

  it('titles and borders the invoice summary rather than emitting bare rows', () => {
    const html = renderEmailReceiptHtml(base);
    expect(html).toContain('Invoice summary');
    expect(html).toContain('Invoice number');
    expect(html).toContain('Amount due');
    expect(html).toContain('Due date');
  });

  it('closes with the legal footer, linked absolutely', () => {
    const html = renderEmailReceiptHtml(base);
    expect(html).toContain('href="https://admin.example.com/terms"');
    expect(html).toContain('href="https://admin.example.com/privacy"');
    expect(html).toContain('Terms &amp; Conditions');
    expect(html).toContain('Privacy Policy');
  });

  it('stretches the call to action to full width', () => {
    expect(renderEmailReceiptHtml(base)).toContain('display:block;width:100%');
  });

  it('emphasises substituted values in the body and subject', () => {
    const html = renderEmailReceiptHtml({
      ...base,
      subject: 'Invoice INV-3021 is ready',
      body: 'Hi Harborline, INV-3021 for $4,820.00 is due Aug 26, 2026.',
      variables: { ...base.variables, customerName: 'Harborline' },
    });
    expect(html).toContain('<strong style="font-weight:700;color:#0F172A;">INV-3021</strong>');
    expect(html).toContain('<strong style="font-weight:700;color:#0F172A;">$4,820.00</strong>');
    expect(html).toContain('<strong style="font-weight:700;color:#0F172A;">Aug 26, 2026</strong>');
    expect(html).toContain('<strong style="font-weight:700;color:#0F172A;">Harborline</strong>');
    // The subject picks up the brand colour there, as it does in the preview.
    expect(html).toContain('<strong style="color:#2D6A6A;">INV-3021</strong>');
  });

  it('emphasises the longer value when one contains another', () => {
    const html = renderEmailReceiptHtml({
      ...base,
      body: 'Invoice INV-3021-B is ready.',
      variables: { ...base.variables, invoiceNumber: 'INV-3021-B', customerName: 'INV-3021' },
    });
    expect(html).toContain('>INV-3021-B</strong>');
  });

  it('leaves a single-character value alone rather than bolding every one of it', () => {
    const html = renderEmailReceiptHtml({
      ...base,
      body: 'A trip to a shop.',
      variables: { ...base.variables, customerName: 'A' },
    });
    expect(html).toContain('>A trip to a shop.</p>');
  });

  it('emphasises a value containing regex metacharacters literally', () => {
    const html = renderEmailReceiptHtml({
      ...base,
      body: 'Total $4,820.00 (final).',
      variables: { ...base.variables, amountDue: '$4,820.00' },
    });
    expect(html).toContain('>$4,820.00</strong>');
  });
});
