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
 * The grouping the invoices list's tabs and status column use: every open,
 * non-overdue status (SENT/VIEWED/PENDING_PAYMENT) reads as "Unpaid",
 * PARTIALLY_PAID gets its own "Partial" bucket (a customer who has already
 * paid something is a different situation from one who has paid nothing),
 * and the `overdue` overlay flag (see OPEN_INVOICE_STATUSES above and
 * invoice-status.ts) promotes either of those to "Overdue" rather than
 * adding a status of its own.
 */
export type InvoiceListStatus = 'DRAFT' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export function invoiceListStatus(invoice: {
  status: string;
  overdue: boolean;
}): InvoiceListStatus {
  if (invoice.status === 'DRAFT') return 'DRAFT';
  if (invoice.status === 'PAID') return 'PAID';
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  if (invoice.overdue) return 'OVERDUE';
  return invoice.status === 'PARTIALLY_PAID' ? 'PARTIAL' : 'UNPAID';
}

/** DRAFT -> "Draft". Title case for a person, not the shouted wire format. */
export function invoiceListStatusLabel(status: InvoiceListStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Tailwind text colour for the grouped status — drives both the dot and the label. */
export function invoiceListStatusTone(status: InvoiceListStatus): string {
  if (status === 'PAID') return 'text-success';
  if (status === 'OVERDUE') return 'text-danger';
  if (status === 'UNPAID' || status === 'PARTIAL') return 'text-warning';
  return 'text-ink-subtle';
}

/** Tailwind background colour for the status dot — one shade darker than the
 * surface tint so it reads as a solid dot rather than a wash. */
export function invoiceListStatusDot(status: InvoiceListStatus): string {
  if (status === 'PAID') return 'bg-success';
  if (status === 'OVERDUE') return 'bg-danger';
  if (status === 'UNPAID' || status === 'PARTIAL') return 'bg-warning';
  return 'bg-ink-subtle';
}

/**
 * The Invoice Details screen's own, more specific grouping — it has room for
 * a badge per real status rather than the list's four tab buckets, so
 * PARTIALLY_PAID gets its own "Partial" (folded into "Unpaid" on the list)
 * and SENT/VIEWED stay distinguishable instead of both reading as "Unpaid".
 * The `overdue` overlay still wins over all of those, same as the list.
 */
export type InvoiceDetailStatus =
  'DRAFT' | 'SENT' | 'VIEWED' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'CANCELLED';

export function invoiceDetailStatus(invoice: {
  status: string;
  overdue: boolean;
}): InvoiceDetailStatus {
  if (invoice.status === 'DRAFT') return 'DRAFT';
  if (invoice.status === 'PAID') return 'PAID';
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  if (invoice.overdue) return 'OVERDUE';
  if (invoice.status === 'PARTIALLY_PAID') return 'PARTIAL';
  if (invoice.status === 'VIEWED') return 'VIEWED';
  return 'SENT'; // SENT or PENDING_PAYMENT, neither overdue yet
}

export function invoiceDetailStatusLabel(status: InvoiceDetailStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Pill background + text — the header badge next to the invoice number.
 * Same three-colour vocabulary as the list (success/warning/danger), plus a
 * muted surface for the states that are neither an amount owed nor overdue. */
export function invoiceDetailStatusBadgeClass(status: InvoiceDetailStatus): string {
  if (status === 'PAID') return 'bg-success-surface text-success';
  if (status === 'OVERDUE') return 'bg-danger-surface text-danger';
  if (status === 'PARTIAL') return 'bg-warning-surface text-warning';
  return 'bg-surface-muted text-ink-muted';
}
