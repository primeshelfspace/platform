import { describe, expect, it } from 'vitest';
import { renderEmailReceiptHtml, type EmailReceiptHtmlInput } from './email-receipt-html.js';

const base: EmailReceiptHtmlInput = {
  layout: 'CLASSIC',
  brandName: 'Cobalt Studio Supply',
  themeColor: '#2D6A6A',
  accentColor: '#CC0066',
  logoSrc: null,
  subject: 'New invoice from Cobalt Studio Supply',
  body: 'Hi Harborline,\n\nYour invoice is ready.',
  variables: { invoiceNumber: 'INV-3021', amountDue: '$4,820.00', dueDate: 'Aug 26, 2026' },
  linkUrl: 'https://pay.example.com/i/tok_123',
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

  it('gives CLASSIC a colour band and MINIMAL none', () => {
    const classic = renderEmailReceiptHtml(base);
    const minimal = renderEmailReceiptHtml({ ...base, layout: 'MINIMAL' });
    expect(classic).toContain('height:6px');
    expect(minimal).not.toContain(`background:${base.themeColor};font-size:0`);
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
});
