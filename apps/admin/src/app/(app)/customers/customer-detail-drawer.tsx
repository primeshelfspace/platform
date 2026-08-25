'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, type CurrencyCode } from '@fenwick/shared/money';
import type { CustomerAddress, CustomerWithContacts, Invoice } from '@/lib/api';

const TABS = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'contacts', label: 'Contact Persons' },
  { key: 'payments', label: 'Payments' },
  { key: 'activity', label: 'Activity' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Up to two initials from a display name — "Catalog Group of Companies" ->
 * "CG". Falls back to "?" for a blank name rather than an empty circle. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words[0]?.charAt(0) ?? '') + (words[1]?.charAt(0) ?? '');
  return (initials || '?').toUpperCase();
}

/** Two lines the way a person addresses an envelope — "street, suite" then
 * "city, region postal" — not the six-field comma-joined dump the old full
 * page used. Empty when there's nothing on file, so the caller can fall back
 * to "Not on file" cleanly. */
function addressLines(address: CustomerAddress | null): string[] {
  if (!address) return [];
  const line1 = [address.line1, address.line2].filter(Boolean).join(', ');
  const line2 = [[address.city, address.region].filter(Boolean).join(', '), address.postalCode]
    .filter(Boolean)
    .join(' ');
  return [line1, line2].filter(Boolean);
}

function InfoField({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div>
      <p className="text-sm text-[#64748B]">{label}</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm font-medium text-[#94A3B8]">Not on file</p>
      ) : (
        lines.map((line) => (
          <p key={line} className="mt-1 text-sm font-medium text-[#0F172A]">
            {line}
          </p>
        ))
      )}
    </div>
  );
}

function DotBadge({ tone, label }: { tone: 'success' | 'subtle'; label: string }) {
  const dot = tone === 'success' ? 'bg-success' : 'bg-ink-subtle';
  const text = tone === 'success' ? 'text-success' : 'text-ink-subtle';
  return (
    <p className={`mt-1.5 flex items-center gap-1.5 text-sm font-semibold ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </p>
  );
}

/** This tab's own status, distinct from the main Invoices list's grouping
 * (invoice-presentation.ts's invoiceListStatus folds PARTIALLY_PAID into
 * "Unpaid" for that page's tab counts) — here a partial payment is worth
 * calling out on its own, the way a person skimming a customer's balance
 * would want to see it. */
function drawerInvoiceStatus(invoice: Invoice): { label: string; dot: string; text: string } {
  if (invoice.status === 'PAID') return { label: 'Paid', dot: 'bg-success', text: 'text-success' };
  if (invoice.status === 'CANCELLED') {
    return { label: 'Cancelled', dot: 'bg-ink-subtle', text: 'text-ink-subtle' };
  }
  if (invoice.status === 'DRAFT')
    return { label: 'Draft', dot: 'bg-ink-subtle', text: 'text-ink-subtle' };
  if (invoice.overdue) return { label: 'Overdue', dot: 'bg-danger', text: 'text-danger' };
  if (invoice.status === 'PARTIALLY_PAID') {
    return { label: 'Partial', dot: 'bg-warning', text: 'text-warning' };
  }
  return { label: 'Unpaid', dot: 'bg-warning', text: 'text-warning' };
}

function ComingSoonPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-10 text-center">
      <p className="text-sm font-medium text-[#0F172A]">Not built yet</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#64748B]">
        {label} will show here once it&apos;s wired up.
      </p>
    </div>
  );
}

export function CustomerDetailDrawer({
  open,
  onClose,
  brandName,
  loading,
  error,
  customer,
  invoices,
  outstandingMinor,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  brandName: string | undefined;
  loading: boolean;
  error: string | null;
  customer: CustomerWithContacts | null;
  invoices: Invoice[];
  /** Passed down from the list row rather than re-derived from `invoices`,
   * so this figure always matches what the table the drawer was opened from
   * already showed — the list's own computation may exclude drafts or other
   * cases this component shouldn't have to re-decide. */
  outstandingMinor: number;
  currency: CurrencyCode;
}) {
  const [tab, setTab] = useState<TabKey>('invoices');

  if (!open) return null;

  // Portalled straight to <body>: this component renders inside the (app)
  // layout's `.page-transition` wrapper, which carries a `transform` (its
  // enter-animation's `both` fill-mode keeps `translateY(0)` applied forever
  // after it finishes). Any transform on an ancestor makes it the containing
  // block for `position: fixed` descendants, so without the portal this
  // drawer would size itself to that wrapper's own content height — usually
  // close enough to the viewport to go unnoticed, but visibly wrong on a
  // short page (e.g. a brand with only one customer row).
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F172A]
                         text-base font-bold text-white"
              aria-hidden
            >
              {customer ? initialsOf(customer.displayName) : ''}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-[#0F172A]">
                {customer?.displayName ?? (loading ? 'Loading…' : 'Customer')}
              </h2>
              {brandName && <p className="text-sm text-[#64748B]">{brandName}</p>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              disabled
              title="Editing customers isn't available yet"
              className="inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-[#D4D4D4]
                         bg-white px-4 text-sm font-bold text-[#0F172A] opacity-50"
            >
              Edit Details
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close customer details"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#64748B]
                         transition-colors hover:bg-[#F5F5F6] hover:text-[#0F172A]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex-1 px-6 pb-10 pt-5">
          {loading ? (
            <div className="skeleton-fade-in space-y-3" aria-hidden>
              <div className="skeleton-block h-4 w-32 rounded bg-surface-muted" />
              <div className="skeleton-block h-4 w-48 rounded bg-surface-muted" />
              <div className="skeleton-block mt-6 h-24 rounded-lg bg-surface-muted" />
            </div>
          ) : error || !customer ? (
            <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
              <p className="font-medium">Could not load this customer.</p>
              {error && <p className="mt-1 font-mono text-xs">{error}</p>}
            </div>
          ) : (
            <>
              <div className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-[#64748B]">Status</p>
                  <DotBadge
                    tone={customer.status === 'ACTIVE' ? 'success' : 'subtle'}
                    label={customer.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  />
                </div>
                <div>
                  <p className="text-sm text-[#64748B]">Zoho Sync</p>
                  <DotBadge
                    tone={customer.zohoContactId ? 'success' : 'subtle'}
                    label={customer.zohoContactId ? 'Synced' : 'Not synced'}
                  />
                </div>

                <InfoField label="Email" lines={customer.email ? [customer.email] : []} />
                <InfoField label="Billing Address" lines={addressLines(customer.billingAddress)} />

                <InfoField label="Phone" lines={customer.phone ? [customer.phone] : []} />
                <InfoField
                  label="Shipping Address"
                  lines={addressLines(customer.shippingAddress)}
                />
              </div>

              <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                <p className="text-sm font-bold text-[#0F172A]">Outstanding Balance</p>
                <p className="mt-1 font-mono text-3xl font-bold" style={{ color: '#D97706' }}>
                  {formatMinorForDisplay(outstandingMinor, currency)}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-6 border-b border-[#E5E7EB]">
                {TABS.map((t) => {
                  const active = t.key === tab;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      aria-current={active ? 'true' : undefined}
                      className={`border-b-2 px-1 pb-2 text-sm transition-colors ${
                        active
                          ? 'border-[#0F172A] font-bold text-[#0F172A]'
                          : 'border-transparent font-medium text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                {tab === 'invoices' ? (
                  invoices.length === 0 ? (
                    <p className="py-8 text-center text-sm text-ink-muted">
                      No invoices for this customer yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr
                            className="border-b border-[#E5E7EB] bg-[#F5F5F6] text-left text-xs
                                          font-semibold uppercase tracking-wide text-[#8C919B]"
                          >
                            <th className="px-4 py-2">Invoice</th>
                            <th className="px-4 py-2">Issue Date</th>
                            <th className="px-4 py-2">Due Date</th>
                            <th className="px-4 py-2">Total Due</th>
                            <th className="px-4 py-2">Balance Due</th>
                            <th className="px-4 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((invoice) => {
                            const status = drawerInvoiceStatus(invoice);
                            return (
                              <tr
                                key={invoice.id}
                                className="border-b border-[#E5E7EB] last:border-0"
                              >
                                <td className="px-4 py-2 font-medium text-[#0F172A]">
                                  {invoice.number}
                                </td>
                                <td className="px-4 py-2 text-[#64748B]">
                                  {formatDateForDisplay(invoice.invoiceDate)}
                                </td>
                                <td className="px-4 py-2 text-[#64748B]">
                                  {formatDateForDisplay(invoice.dueDate)}
                                </td>
                                <td className="px-4 py-2 font-mono text-[#0F172A]">
                                  {formatMinorForDisplay(invoice.totalMinor, currency)}
                                </td>
                                <td className={`px-4 py-2 font-mono ${status.text}`}>
                                  {invoice.balanceMinor > 0
                                    ? formatMinorForDisplay(invoice.balanceMinor, currency)
                                    : '--'}
                                </td>
                                <td className={`px-4 py-2 font-medium ${status.text}`}>
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
                                      aria-hidden
                                    />
                                    {status.label}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : tab === 'contacts' ? (
                  customer.contactPersons.length === 0 ? (
                    <p className="py-8 text-center text-sm text-ink-muted">
                      No contact persons on file for this customer.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr
                            className="border-b border-[#E5E7EB] bg-[#F5F5F6] text-left text-xs
                                          font-semibold uppercase tracking-wide text-[#8C919B]"
                          >
                            <th className="px-4 py-2">Name</th>
                            <th className="px-4 py-2">Designation</th>
                            <th className="px-4 py-2">Email</th>
                            <th className="px-4 py-2">Phone</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {customer.contactPersons.map((person) => (
                            <tr key={person.id} className="border-b border-[#E5E7EB] last:border-0">
                              <td className="px-4 py-2 font-medium text-[#0F172A]">
                                {[person.salutation, person.firstName, person.lastName]
                                  .filter(Boolean)
                                  .join(' ') || '—'}
                              </td>
                              <td className="px-4 py-2 text-[#64748B]">
                                {person.designation ?? '—'}
                              </td>
                              <td className="px-4 py-2 text-[#64748B]">{person.email ?? '—'}</td>
                              <td className="px-4 py-2 text-[#64748B]">
                                {person.phone ?? person.mobile ?? '—'}
                              </td>
                              <td className="px-4 py-2">
                                {person.isPrimaryContact && (
                                  <span
                                    className="rounded-full bg-[#F5F5F6] px-2 py-0.5 text-xs font-semibold
                                               text-[#64748B]"
                                  >
                                    Primary
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : tab === 'payments' ? (
                  <ComingSoonPanel label="This customer's payment history" />
                ) : (
                  <ComingSoonPanel label="A timeline of activity on this customer" />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
