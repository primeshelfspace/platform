'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { toast } from '@fenwick/ui/toast';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { Brand, InvoiceActivityEntry, InvoiceDetail } from '@/lib/api';
import {
  invoiceDetailStatus,
  invoiceDetailStatusBadgeClass,
  invoiceDetailStatusLabel,
} from '@/lib/invoice-presentation';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { SendInvoiceModal } from './send-invoice-modal';

// Same public payment app the "View & Pay Invoice" link in an invoice email
// points at (SendInvoiceModal's own viewUrl) — Share and Copy Link hand out
// that same URL, just from the drawer instead of the compose modal.
const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

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
      <span
        className={`h-1.5 w-1.5 rounded-full ${synced ? 'bg-success' : 'bg-danger'}`}
        aria-hidden
      />
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
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const shareMenuRef = useDismissablePanel<HTMLDivElement>(shareMenuOpen, () =>
    setShareMenuOpen(false),
  );

  if (!open) return null;

  const status = invoice ? invoiceDetailStatus(invoice) : null;
  const currency = toCurrencyCode(invoice?.currency);
  // Draft invoices have no active public token yet — same gate Download PDF
  // already uses below, since a link to an inactive token 404s on arrival.
  const shareUrl =
    invoice && status !== 'DRAFT' ? `${PAYMENT_PUBLIC_URL}/i/${invoice.publicToken}` : null;
  const shareMessage = invoice
    ? `Invoice ${invoice.number} — ${formatMinorForDisplay(invoice.balanceMinor, currency)} due. View & pay: ${shareUrl}`
    : '';

  function handleSent() {
    router.refresh(); // the list row behind this drawer needs the new status too
    onChanged();
  }

  async function handleCopyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      toast.success('Link copied', { description: shareUrl });
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link — copy it from your browser instead.');
    }
  }

  function handleShareWhatsApp() {
    if (!shareUrl) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank', 'noopener');
    setShareMenuOpen(false);
  }

  // No direct Chatly deep-link/API exists to target yet, so this goes
  // through the browser's native share sheet (which lists Chatly itself if
  // it's installed on the device) and falls back to copying the link with a
  // Chatly-specific hint when that API isn't available (most desktop
  // browsers) or the user backs out of it without picking anything.
  async function handleShareChatly() {
    if (!shareUrl) return;
    setShareMenuOpen(false);
    if (navigator.share) {
      try {
        await navigator.share({
          title: invoice ? `Invoice ${invoice.number}` : 'Invoice',
          text: shareMessage,
          url: shareUrl,
        });
        return;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return; // user cancelled the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied', { description: 'Paste it into Chatly to share.' });
    } catch {
      toast.error('Could not share the link — copy it from your browser instead.');
    }
  }

  // Portalled straight to <body> — same reason CustomerDetailDrawer's own
  // comment gives: an ancestor's transform (the (app) layout's page-transition
  // wrapper) would otherwise become this drawer's containing block, sizing it
  // to that wrapper's content height instead of the real viewport.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div className="relative flex h-full w-1/2 flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4 px-8 py-6">
          <div className="min-w-0">
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

          <div className="flex flex-wrap shrink-0 items-center justify-end gap-3">
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
            {/* Same public, token-only route the payment page's own "Download
              invoice" points at (apps/api's public/invoices/:token/pdf) —
              draft invoices have no active public token yet, so this stays
              disabled until the invoice is actually sent. */}
            {invoice && status !== 'DRAFT' ? (
              <a
                href={`${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'}/public/invoices/${invoice.publicToken}/pdf`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#D4D4D4] bg-white px-4
                           text-sm font-bold text-ink-strong transition-colors hover:bg-surface-muted"
              >
                <Download className="h-4 w-4" aria-hidden />
                Download PDF
              </a>
            ) : (
              <button
                type="button"
                disabled
                title={status === 'DRAFT' ? 'Send the invoice first to generate a PDF' : undefined}
                className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-[#D4D4D4]
                           bg-white px-4 text-sm font-bold text-ink-muted opacity-60"
              >
                <Download className="h-4 w-4" aria-hidden />
                Download PDF
              </button>
            )}
            {shareUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  title="Copy the invoice's shareable link"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#D4D4D4] bg-white px-4
                             text-sm font-bold text-ink-strong transition-colors hover:bg-surface-muted"
                >
                  {linkCopied ? (
                    <Check className="h-4 w-4 text-success" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                  {linkCopied ? 'Copied' : 'Copy Link'}
                </button>

                <div className="relative shrink-0" ref={shareMenuRef}>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={shareMenuOpen}
                    onClick={() => setShareMenuOpen((v) => !v)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#D4D4D4] bg-white px-4
                               text-sm font-bold text-ink-strong transition-colors hover:bg-surface-muted"
                  >
                    <Share2 className="h-4 w-4" aria-hidden />
                    Share
                    <ChevronDown className="h-4 w-4 text-[#64748B]" aria-hidden />
                  </button>

                  {shareMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Share invoice"
                      className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-[#E5E7EB]
                                 bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleShareWhatsApp}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-strong
                                   transition-colors hover:bg-[#F5F5F6]"
                      >
                        <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden />
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleShareChatly}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-strong
                                   transition-colors hover:bg-[#F5F5F6]"
                      >
                        <MessageCircle className="h-4 w-4 text-[#6366F1]" aria-hidden />
                        Chatly
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
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
                    <p className="mt-1 text-sm font-semibold text-ink-strong">
                      {paymentTermsLabel}
                    </p>
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
                        <li
                          key={i}
                          className="flex items-center justify-between gap-4 py-3.5 text-sm"
                        >
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
