/**
 * How an invoice status is rendered, in one place.
 *
 * The dashboard and the invoice list each carried their own byte-identical
 * `statusTone`, so a new status (or a change of palette) had to be applied
 * twice and would otherwise show one colour on one screen and another
 * elsewhere. The sync-activity panel's own `statusTone` is deliberately NOT
 * folded in here — it colours SyncJob states (QUEUED/RUNNING/FAILED), a
 * different vocabulary that only looks similar.
 */

/** Tailwind text colour for an invoice status. */
export function invoiceStatusTone(status: string): string {
  if (status === 'PAID') return 'text-success';
  if (status === 'CANCELLED') return 'text-ink-subtle';
  if (status === 'PENDING_PAYMENT' || status === 'PARTIALLY_PAID') return 'text-warning';
  return 'text-ink-strong';
}

/** PENDING_PAYMENT -> "PENDING PAYMENT". Underscores are a wire format, not
 * something to show a person. */
export function invoiceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * The four-way grouping the invoices list's tabs and status column use:
 * every open, non-overdue status (SENT/VIEWED/PENDING_PAYMENT/PARTIALLY_PAID)
 * reads as "Unpaid"; the `overdue` overlay flag (see OPEN_INVOICE_STATUSES
 * above and invoice-status.ts) promotes that same row to "Overdue" rather
 * than adding a status of its own.
 */
export type InvoiceListStatus = 'DRAFT' | 'UNPAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export function invoiceListStatus(invoice: {
  status: string;
  overdue: boolean;
}): InvoiceListStatus {
  if (invoice.status === 'DRAFT') return 'DRAFT';
  if (invoice.status === 'PAID') return 'PAID';
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  return invoice.overdue ? 'OVERDUE' : 'UNPAID';
}

/** DRAFT -> "Draft". Title case for a person, not the shouted wire format. */
export function invoiceListStatusLabel(status: InvoiceListStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Tailwind text colour for the grouped status — drives both the dot and the label. */
export function invoiceListStatusTone(status: InvoiceListStatus): string {
  if (status === 'PAID') return 'text-success';
  if (status === 'OVERDUE') return 'text-danger';
  if (status === 'UNPAID') return 'text-warning';
  return 'text-ink-subtle';
}

/** Tailwind background colour for the status dot — one shade darker than the
 * surface tint so it reads as a solid dot rather than a wash. */
export function invoiceListStatusDot(status: InvoiceListStatus): string {
  if (status === 'PAID') return 'bg-success';
  if (status === 'OVERDUE') return 'bg-danger';
  if (status === 'UNPAID') return 'bg-warning';
  return 'bg-ink-subtle';
}
