'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Pencil, RefreshCw, Send, X } from 'lucide-react';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { Brand, InvoiceActivityEntry, InvoiceDetail } from '@/lib/api';
import {
  invoiceDetailStatus,
  invoiceDetailStatusBadgeClass,
  invoiceDetailStatusLabel,
} from '@/lib/invoice-presentation';
import { SendInvoiceModal } from './send-invoice-modal';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** ISSUE -> "Invoice sent", etc. — InvoiceEvent.eventType is a wire value
 * ("ISSUE", "FIRST_VIEW"), not something to show a person verbatim. Falls
 * back to the raw value for anything not yet named here rather than hiding
 * the event. */
const EVENT_LABEL: Record<string, string> = {
  ISSUE: 'Invoice sent',
  FIRST_VIEW: 'Customer viewed the invoice',
  PAYMENT_SETTLED: 'Payment received',
  PAYMENT_FAILED: 'Payment attempt failed',
  EMAIL_SENT: 'Invoice emailed',
  // Recorded by the old resend-only endpoint, before it merged into
  // sendEmail — kept so already-recorded history still reads nicely.
  EMAIL_RESENT: 'Invoice emailed',
};

function eventLabel(entry: InvoiceActivityEntry): string {
  return EVENT_LABEL[entry.eventType] ?? entry.eventType.replace(/_/g, ' ');
}

function SyncBadge({ synced }: { synced: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        synced ? 'bg-success-surface text-success' : 'bg-danger-surface text-danger'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${synced ? 'bg-success' : 'bg-danger'}`} aria-hidden />
      {synced ? 'Synced' : 'Not Synced'}
    </span>
  );
}

export function InvoiceDetailDrawer({
  open,
  onClose,
  brand,
  loading,
  error,
  invoice,
  activity,
  paymentTermsLabel,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  brand: Brand | null;
  loading: boolean;
  error: string | null;
  invoice: InvoiceDetail | null;
  activity: InvoiceActivityEntry[];
  paymentTermsLabel: string | null | undefined;
  /** Called after a successful Send — the parent owns the actual data
   * (this component only holds ephemeral UI state), so a status change
   * means asking it to re-fetch rather than patching a local copy here. */
  onChanged: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'items' | 'activity'>('items');
  const [sendModalOpen, setSendModalOpen] = useState(false);

  if (!open) return null;

  const status = invoice ? invoiceDetailStatus(invoice) : null;
  const currency = toCurrencyCode(invoice?.currency);

  function handleSent() {
    router.refresh(); // the list row behind this drawer needs the new status too
    onChanged();
  }

  // Portalled straight to <body> — same reason CustomerDetailDrawer's own
  // comment gives: an ancestor's transform (the (app) layout's page-transition
  // wrapper) would otherwise become this drawer's containing block, sizing it
  // to that wrapper's content height instead of the real viewport.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div className="relative flex h-full w-1/2 flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 px-8 py-6">
          <div>
            <p className="text-sm text-ink-muted">Invoice #</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-ink-strong">
                {invoice?.number ?? (loading ? 'Loading…' : 'Invoice')}
              </h2>
              {status && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${invoiceDetailStatusBadgeClass(status)}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  {invoiceDetailStatusLabel(status)}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {status === 'DRAFT' && (
              <button
                type="button"
                onClick={() => setSendModalOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-black px-4 text-sm font-bold text-white
                           transition-colors hover:bg-neutral-800"
              >
                <Send className="h-4 w-4" aria-hidden />
                Send
              </button>
            )}
            {status && status !== 'DRAFT' && (
              <button
                type="button"
                onClick={() => setSendModalOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#D4D4D4] bg-white px-4
                           text-sm font-bold text-ink-strong transition-colors hover:bg-surface-muted"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Resend
              </button>
            )}
            <button
              type="button"
              disabled
              title="PDF generation isn't built yet"
              className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-[#D4D4D4]
                         bg-white px-4 text-sm font-bold text-ink-muted opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download PDF
            </button>
            {status === 'DRAFT' && (
              <button
                type="button"
                disabled
                title="Editing a draft isn't built yet"
                className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-[#D4D4D4]
                           bg-white px-4 text-sm font-bold text-ink-muted opacity-60"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close invoice details"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted
                         transition-colors hover:bg-[#F5F5F6] hover:text-ink-strong"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex-1 px-8 pb-10">
          {loading ? (
            <div className="skeleton-fade-in space-y-3" aria-hidden>
              <div className="skeleton-block h-4 w-32 rounded bg-surface-muted" />
              <div className="skeleton-block h-4 w-48 rounded bg-surface-muted" />
              <div className="skeleton-block mt-6 h-32 rounded-lg bg-surface-muted" />
            </div>
          ) : error || !invoice || !brand ? (
            <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
              <p className="font-medium">Could not load this invoice.</p>
              {error && <p className="mt-1 font-mono text-xs">{error}</p>}
            </div>
          ) : (
            <>
              <div className="grid gap-x-16 gap-y-6 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-ink-muted">Customer</p>
                  <Link
                    href={`/customers?brandId=${brand.id}&search=${encodeURIComponent(invoice.customer.displayName)}`}
                    className="mt-1 block text-sm font-semibold text-[#2563EB] hover:underline"
                  >
                    {invoice.customer.displayName}
                  </Link>
                </div>
                <div>
                  <p className="text-sm text-ink-muted">Brand</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: brand.logoUrl ? undefined : brand.themeColor }}
                      aria-hidden
                    >
                      {brand.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={brand.logoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialOf(brand.displayName)
                      )}
                    </span>
                    <span className="text-sm font-semibold text-ink-strong">
                      {brand.displayName}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-ink-muted">Invoice Date</p>
                  <p className="mt-1 text-sm font-semibold text-ink-strong">
                    {formatDateForDisplay(invoice.invoiceDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-ink-muted">Due Date</p>
                  <p className="mt-1 text-sm font-semibold text-ink-strong">
                    {formatDateForDisplay(invoice.dueDate)}
                  </p>
                </div>

                {paymentTermsLabel && (
                  <div>
                    <p className="text-sm text-ink-muted">Payment Terms</p>
                    <p className="mt-1 text-sm font-semibold text-ink-strong">{paymentTermsLabel}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-ink-muted">Zoho Sync</p>
                  <div className="mt-1">
                    <SyncBadge synced={Boolean(invoice.zohoInvoiceId)} />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex items-center gap-8 border-b border-[#E5E7EB]">
                {(
                  [
                    { key: 'items' as const, label: 'Line Items' },
                    { key: 'activity' as const, label: 'Activity' },
                  ] satisfies { key: 'items' | 'activity'; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-current={tab === t.key ? 'true' : undefined}
                    className={`border-b-2 px-1 pb-3 text-sm transition-colors ${
                      tab === t.key
                        ? 'border-[#0F172A] font-bold text-[#0F172A]'
                        : 'border-transparent font-medium text-[#64748B] hover:text-[#0F172A]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'items' ? (
                <div className="mt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="bg-[#F5F5F6] text-xs font-semibold uppercase tracking-wide text-[#8C919B]">
                          <th className="w-10 px-4 py-2">#</th>
                          <th className="px-3 py-2">Item &amp; Description</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                          <th className="px-4 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.lineItems.map((line, index) => (
                          <tr key={line.id} className="border-b border-[#E5E7EB] last:border-0">
                            <td className="px-4 py-3 text-ink-muted">{index + 1}</td>
                            <td className="px-3 py-3 font-medium text-ink-strong">
                              {line.itemName}
                            </td>
                            <td className="px-3 py-3 text-right text-ink-muted">{line.quantity}</td>
                            <td className="px-3 py-3 text-right text-ink-muted">
                              {formatMinorForDisplay(line.unitPriceMinor, currency)}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-ink-strong">
                              {formatMinorForDisplay(line.lineTotalMinor, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <div className="w-64 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-ink-muted">Subtotal</span>
                        <span className="font-medium text-ink-strong">
                          {formatMinorForDisplay(invoice.subtotalMinor, currency)}
                        </span>
                      </div>
                      {invoice.taxMinor > 0 && (
                        <div className="flex justify-between">
                          <span className="text-ink-muted">
                            Tax ({invoice.taxRateBpApplied / 100}%)
                          </span>
                          <span className="font-medium text-ink-strong">
                            {formatMinorForDisplay(invoice.taxMinor, currency)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-[#E5E7EB] pt-2 font-bold text-ink-strong">
                        <span>Total</span>
                        <span>{formatMinorForDisplay(invoice.totalMinor, currency)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-ink-strong">
                        <span>Balance Due</span>
                        <span>{formatMinorForDisplay(invoice.balanceMinor, currency)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  {activity.length === 0 ? (
                    <p className="py-8 text-center text-sm text-ink-muted">
                      No activity yet — nothing has happened to this invoice.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#E5E7EB]">
                      {activity.map((entry, i) => (
                        <li key={i} className="flex items-center justify-between gap-4 py-3.5 text-sm">
                          <span className="font-medium text-ink-strong">{eventLabel(entry)}</span>
                          <span className="shrink-0 text-xs text-ink-muted">
                            {new Date(entry.occurredAt).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {invoice && brand && status && (
        <SendInvoiceModal
          open={sendModalOpen}
          onClose={() => setSendModalOpen(false)}
          brand={brand}
          invoice={invoice}
          isFirstSend={status === 'DRAFT'}
          onSent={handleSent}
        />
      )}
    </div>,
    document.body,
  );
}
