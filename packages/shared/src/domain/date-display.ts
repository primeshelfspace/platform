/**
 * Short US date for display — "Aug 14, 2026".
 *
 * Was reimplemented independently three times with the exact same
 * Intl.DateTimeFormat options object: the invoices list, the brand settings
 * preview (both apps/admin), and the email-receipt preview (apps/api). Money
 * and quantity each have exactly one shared formatter already
 * (formatMinorForDisplay, formatQuantity) — this gives dates the same thing.
 */

/** Accepts a Date or an ISO-ish string so both a Prisma row (already a Date)
 * and a JSON API response (a string) can call this directly. */
export function formatDateForDisplay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
