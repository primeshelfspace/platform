import { describe, expect, it } from 'vitest';
import { EMAIL_RECEIPT_VARIABLES, renderEmailReceiptTemplate } from './email-receipt-template.js';

const VARIABLES = {
  brandName: 'Solstice',
  customerName: 'Jane Doe',
  invoiceNumber: 'INV-1042',
  amountDue: '$392.48',
  dueDate: 'Sep 1, 2026',
};

describe('renderEmailReceiptTemplate', () => {
  it('substitutes every known placeholder', () => {
    const rendered = renderEmailReceiptTemplate(
      'Hi {{customer_name}}, {{brand_name}} invoice {{invoice_number}} for {{amount_due}} is due {{due_date}}.',
      VARIABLES,
    );
    expect(rendered).toBe('Hi Jane Doe, Solstice invoice INV-1042 for $392.48 is due Sep 1, 2026.');
  });

  it('replaces every occurrence, not just the first', () => {
    const rendered = renderEmailReceiptTemplate('{{brand_name}} — {{brand_name}}', VARIABLES);
    expect(rendered).toBe('Solstice — Solstice');
  });

  it('leaves an unrecognised token as-is rather than blanking it', () => {
    const rendered = renderEmailReceiptTemplate('Hello {{unknown_token}}!', VARIABLES);
    expect(rendered).toBe('Hello {{unknown_token}}!');
  });

  it('is a no-op on a template with no placeholders', () => {
    expect(renderEmailReceiptTemplate('Thanks for your business.', VARIABLES)).toBe(
      'Thanks for your business.',
    );
  });
});

describe('EMAIL_RECEIPT_VARIABLES', () => {
  it('lists every placeholder the renderer actually substitutes', () => {
    const rendered = renderEmailReceiptTemplate(
      EMAIL_RECEIPT_VARIABLES.map((v) => v.token).join(' '),
      VARIABLES,
    );
    expect(rendered).not.toMatch(/\{\{/);
  });
});
