'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, User, X } from 'lucide-react';
import type { Brand } from '@/lib/api';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

const CONFIRM_PHRASE = 'Send All';

/**
 * A destructive-ish bulk action (up to a whole tab's worth of invoices,
 * each emailing a real customer) gets a type-to-confirm gate rather than a
 * plain Cancel/Confirm pair — same reasoning as any "type DELETE to confirm"
 * pattern, scaled to this being reversible in principle but not something to
 * fire off by a stray click.
 */
export function BulkSendConfirmModal({
  open,
  onClose,
  brand,
  invoiceCount,
  recipientCount,
  sending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  brand: Brand;
  invoiceCount: number;
  recipientCount: number;
  sending: boolean;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');

  if (!open) return null;

  const confirmed = confirmText.trim() === CONFIRM_PHRASE;

  function handleClose() {
    setConfirmText('');
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-send-confirm-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[600px] rounded-2xl bg-white p-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="bulk-send-confirm-title" className="text-2xl font-bold text-[#0F172A]">
              Bulk Send Invoices
            </h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Each invoice will use its brand&apos;s email template.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#64748B]
                       transition-colors hover:bg-[#F5F5F6] hover:text-[#0F172A]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-5 border-t border-[#E5E7EB] pt-5">
          <div className="flex items-center gap-3 rounded-xl bg-[#F5F5F6] p-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full
                         text-sm font-bold text-white"
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
            <div className="min-w-0">
              <p className="text-xs text-[#64748B]">Brand Template</p>
              <p className="truncate text-base font-bold text-[#0F172A]">{brand.displayName}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-xl bg-[#F5F5F6] p-4">
              <div>
                <p className="text-xs text-[#64748B]">Invoices</p>
                <p className="text-xl font-bold text-[#0F172A]">{invoiceCount}</p>
              </div>
              <Mail className="h-5 w-5 text-[#64748B]" aria-hidden />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#F5F5F6] p-4">
              <div>
                <p className="text-xs text-[#64748B]">Recipients</p>
                <p className="text-xl font-bold text-[#0F172A]">{recipientCount}</p>
              </div>
              <User className="h-5 w-5 text-[#64748B]" aria-hidden />
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-[#E5E7EB] pt-5">
          <p className="text-sm text-[#0F172A]">
            Type{' '}
            <span className="rounded bg-[#F1F1F2] px-1.5 py-0.5 font-semibold">
              {CONFIRM_PHRASE}
            </span>{' '}
            to confirm
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={`Type exactly: ${CONFIRM_PHRASE}`}
            className="mt-2 h-11 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-[#0F172A]
                       placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-[#E5E7EB] pt-5">
          <button
            type="button"
            onClick={handleClose}
            disabled={sending}
            className="inline-flex h-11 items-center rounded-lg border border-[#D4D4D4] bg-white px-5 text-sm
                       font-bold text-[#0F172A] transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || sending}
            className="inline-flex h-11 items-center rounded-lg bg-black px-5 text-sm font-bold text-white
                       transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#D4D4D4]
                       disabled:text-[#94A3B8]"
          >
            {sending ? 'Sending…' : `Send ${invoiceCount} Invoice${invoiceCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Shown in place of the confirm dialog once sending is under way — "N of M
 * sent so far" against the actual count of requests that have resolved, not
 * an animation timed to a guess. No close/cancel here: by the time this is
 * up, sends already in flight can't be un-sent, so there's nothing an early
 * dismiss would honestly stop.
 */
export function BulkSendProgressModal({
  open,
  done,
  total,
}: {
  open: boolean;
  done: number;
  total: number;
}) {
  if (!open) return null;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
    >
      <div className="w-full max-w-[600px] rounded-2xl bg-white p-8 text-center shadow-xl">
        <div
          className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-[#E5E7EB] border-t-[#0F172A]"
          aria-hidden
        />
        <p className="mt-5 text-lg font-bold text-[#0F172A]">Sending invoices…</p>
        <p className="mt-1 text-sm text-[#64748B]">
          {done} of {total} sent so far
        </p>
        <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
          <div
            className="h-full rounded-full bg-[#0F172A] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
