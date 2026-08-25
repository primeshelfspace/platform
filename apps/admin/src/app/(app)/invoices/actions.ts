'use server';

import { revalidatePath } from 'next/cache';
import {
  getInvoice,
  getInvoiceEmailPreview,
  getInvoiceEvents,
  getInvoicePdfSettings,
  issueInvoice,
  sendInvoiceEmail,
  type Invoice,
  type InvoiceActivityEntry,
  type InvoiceDetail,
  type InvoiceEmailDraft,
  type InvoiceEmailSendInput,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

const PAYMENT_TERMS_LABEL: Record<string, string> = {
  DUE_ON_RECEIPT: 'Due on receipt',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
};

export interface InvoiceDetailResult {
  invoice?: InvoiceDetail;
  activity?: InvoiceActivityEntry[];
  /** The brand's currently configured Invoice PDF payment terms — real
   * settings, same as what this invoice's PDF would actually print, but a
   * brand default rather than something captured on the invoice itself at
   * issue time (no per-invoice field for it exists yet). Undefined only if
   * that settings fetch itself failed — never blocks the rest of the drawer. */
  paymentTermsLabel?: string | null;
  error?: string;
}

/** The Invoice Details drawer's own fetch, mirroring
 * customers/actions.ts's getCustomerDetailAction: the invoice itself is
 * required (its failure is the drawer's error state), Activity and Payment
 * Terms are each best-effort and simply absent on their own failure. */
export async function getInvoiceDetailAction(
  brandId: string,
  invoiceId: string,
): Promise<InvoiceDetailResult> {
  const [invoiceOutcome, activityOutcome, pdfSettingsOutcome] = await Promise.allSettled([
    getInvoice(brandId, invoiceId),
    getInvoiceEvents(brandId, invoiceId),
    getInvoicePdfSettings(brandId),
  ]);

  if (invoiceOutcome.status === 'rejected') {
    return { error: describeActionError(invoiceOutcome.reason, 'Could not load this invoice.') };
  }

  return {
    invoice: invoiceOutcome.value,
    activity: activityOutcome.status === 'fulfilled' ? activityOutcome.value : [],
    paymentTermsLabel:
      pdfSettingsOutcome.status === 'fulfilled'
        ? (PAYMENT_TERMS_LABEL[pdfSettingsOutcome.value.paymentTerms] ?? null)
        : null,
  };
}

export type ActionResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** The drawer's "Send" button (draft only) — Draft → Sent, the same
 * transition the "New Invoice" flow already triggers on create. Fires
 * before sendInvoiceEmailAction on a first send, never on a resend. */
export async function issueInvoiceAction(
  brandId: string,
  id: string,
): Promise<ActionResult<Invoice>> {
  try {
    const invoice = await issueInvoice(brandId, id);
    revalidatePath('/invoices');
    return { ok: true, data: invoice };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not send this invoice.') };
  }
}

/** Opens the Send/Resend compose modal — fresh each time (not cached off
 * the drawer's own initial load), so an Email Receipt template edited since
 * the drawer opened, or a customer email added since, shows up here too. */
export async function getInvoiceEmailDraftAction(
  brandId: string,
  id: string,
): Promise<ActionResult<InvoiceEmailDraft>> {
  try {
    const draft = await getInvoiceEmailPreview(brandId, id);
    return { ok: true, data: draft };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not prepare this email.') };
  }
}

/** The compose modal's "Send Invoice" — one real send either way (first
 * send or resend), of exactly what the modal shows on screen. */
export async function sendInvoiceEmailAction(
  brandId: string,
  id: string,
  input: InvoiceEmailSendInput,
): Promise<ActionResult<{ sent: true }>> {
  try {
    const result = await sendInvoiceEmail(brandId, id, input);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not send this invoice.') };
  }
}
