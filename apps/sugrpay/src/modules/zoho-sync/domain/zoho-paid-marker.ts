/** zohoPaymentId of a payment the pull recorded for money received in Zoho
 * (ZohoPullService.recordPaidInZoho), followed by the Zoho invoice id. It
 * marks the payment as Zoho's own, so it is never pushed to Zoho. */
export const ZOHO_PAID_MARKER = 'zoho-invoice-paid:';
