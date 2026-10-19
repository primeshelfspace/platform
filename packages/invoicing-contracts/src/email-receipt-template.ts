/**
 * Email Receipt template variable substitution (FR-MAIL).
 *
 * One function, used by both the admin editor's live preview and the API's
 * test-send path, so the two can never drift into showing different text
 * than what actually gets sent.
 */

export interface EmailReceiptVariables {
  readonly brandName: string;
  readonly customerName: string;
  readonly invoiceNumber: string;
  readonly amountDue: string;
  readonly dueDate: string;
}

/** Every placeholder a subject/body template may use, in the order the
 * editor offers them as insertable chips. */
export const EMAIL_RECEIPT_VARIABLES = [
  { token: '{{brand_name}}', description: "The brand's display name" },
  { token: '{{customer_name}}', description: "The invoice's customer" },
  { token: '{{invoice_number}}', description: 'The invoice number' },
  { token: '{{amount_due}}', description: 'The formatted amount due' },
  { token: '{{due_date}}', description: 'The formatted due date' },
] as const;

/** Replaces every known placeholder in `template` with the matching value
 * from `variables`. Unknown `{{...}}` tokens are left as-is rather than
 * blanked — a typo'd placeholder should be visible, not silently erased. */
export function renderEmailReceiptTemplate(
  template: string,
  variables: EmailReceiptVariables,
): string {
  return template
    .replaceAll('{{brand_name}}', variables.brandName)
    .replaceAll('{{customer_name}}', variables.customerName)
    .replaceAll('{{invoice_number}}', variables.invoiceNumber)
    .replaceAll('{{amount_due}}', variables.amountDue)
    .replaceAll('{{due_date}}', variables.dueDate);
}
