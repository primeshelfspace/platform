'use server';

import { revalidatePath } from 'next/cache';
import {
  bulkSendInvoices,
  cancelInvoice,
  getInvoice,
  getInvoiceEmailPreview,
  getInvoiceEvents,
  getInvoicePdfSettings,
  issueInvoice,
  listInvoices,
  recordInvoicePayment,
  sendInvoiceEmail,
  type BulkSendResult,
  type Invoice,
  type InvoiceActivityEntry,
  type InvoiceDetail,
  type InvoiceEmailDraft,
  type InvoiceEmailSendInput,
  type ManualPaymentInput,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';
import {
  invoiceListStatus,
  invoiceListTabFilter,
  invoiceRangeCutoffIso,
  isBulkSendable,
} from '@/lib/invoice-presentation';

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

/** The drawer's "Record Payment" — money received outside the platform.
 * The server derives the resulting status (Partial or Paid) from the new
 * balance; nothing here sets a status directly. */
export async function recordInvoicePaymentAction(
  brandId: string,
  id: string,
  input: ManualPaymentInput,
): Promise<ActionResult<Invoice>> {
  try {
    const invoice = await recordInvoicePayment(brandId, id, input);
    revalidatePath('/invoices');
    return { ok: true, data: invoice };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not record this payment.') };
  }
}

/** The drawer's "Cancel Invoice" — refused server-side once any payment
 * has settled against it. */
export async function cancelInvoiceAction(
  brandId: string,
  id: string,
): Promise<ActionResult<Invoice>> {
  try {
    const invoice = await cancelInvoice(brandId, id);
    revalidatePath('/invoices');
    return { ok: true, data: invoice };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not cancel this invoice.') };
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

/** A hard ceiling on how many invoices "Select all invoices" will actually
 * collect, not just this one fetch's page size — a brand with more sendable
 * invoices in one tab than this either scrolls through them in batches or
 * narrows the search/date range first; this is only a safety valve against
 * an unbounded loop; no brand has come close to it in practice. */
const MAX_SELECT_ALL_INVOICES = 2_000;
const SELECT_ALL_FETCH_PAGE_SIZE = 200;

/**
 * The invoices list's "Select all invoices" — every sendable row across
 * every page of the current tab/search/date-range, not just the page
 * already on screen (that's `selectableVisible` in InvoicesPageClient, built
 * straight from its own `invoices` prop). Paginates through the same filters
 * `listInvoices` uses for the visible table so the two can never disagree
 * about which rows match.
 */
export async function listSendableInvoicesAction(
  brandId: string,
  filters: { tab: string; search: string; range: string },
): Promise<ActionResult<{ id: string; customerId: string }[]>> {
  try {
    const dateRange = { from: invoiceRangeCutoffIso(filters.range) };
    const tabFilter = invoiceListTabFilter(filters.tab);
    const sendable: { id: string; customerId: string }[] = [];

    let page = 1;
    for (;;) {
      const result = await listInvoices(brandId, {
        page,
        pageSize: SELECT_ALL_FETCH_PAGE_SIZE,
        search: filters.search || undefined,
        dateRange,
        ...tabFilter,
      });
      for (const invoice of result.data) {
        if (isBulkSendable(invoiceListStatus(invoice))) {
          sendable.push({ id: invoice.id, customerId: invoice.customerId });
        }
      }

      const fetched = page * SELECT_ALL_FETCH_PAGE_SIZE;
      if (fetched >= result.total || fetched >= MAX_SELECT_ALL_INVOICES) break;
      page += 1;
    }

    return { ok: true, data: sendable };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not load invoices to select.') };
  }
}

/** The invoices list's "Bulk Send Invoices" button — one real send per
 * selected id, each with that invoice's own default Email Receipt content
 * (no per-invoice compose step, unlike the single-invoice modal above). */
export async function bulkSendInvoicesAction(
  brandId: string,
  ids: string[],
): Promise<ActionResult<BulkSendResult>> {
  try {
    const result = await bulkSendInvoices(brandId, ids);
    revalidatePath('/invoices');
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not send these invoices.') };
  }
}
