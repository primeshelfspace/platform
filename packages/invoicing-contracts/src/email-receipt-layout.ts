/**
 * The three header treatments an invoice receipt email can use.
 *
 * Declared here rather than inferred from the Prisma enum so the admin
 * preview, the zod schema and the HTML renderer all name one list — adding a
 * fourth layout should not compile until every one of them handles it.
 */
export const EMAIL_RECEIPT_LAYOUTS = ['CLASSIC', 'HERO', 'MINIMAL'] as const;
export type EmailReceiptLayout = (typeof EMAIL_RECEIPT_LAYOUTS)[number];
