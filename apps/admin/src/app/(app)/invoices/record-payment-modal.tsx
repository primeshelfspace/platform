'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { toast } from '@sugrpay/ui/toast';
import { formatMinorForDisplay, minorUnitExponent, toCurrencyCode } from '@sugrpay/shared/money';
import type { Brand, InvoiceDetail, ManualPaymentInput } from '@/lib/api';
import { recordInvoicePaymentAction } from './actions';

const METHOD_OPTIONS: { value: ManualPaymentInput['method']; label: string }[] = [
  { value: 'MANUAL', label: 'Cash / Other' },
  { value: 'CHECK', label: 'Check' },
  { value: 'ACH', label: 'Bank transfer' },
];

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-slate-900 focus-visible:ring-offset-1';

/** YYYY-MM-DD in the viewer's own timezone — toISOString would roll over
 * to tomorrow for anyone west of UTC late in the evening. */
function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The Invoice Details drawer's "Record Payment" — money that arrived outside
 * the platform (cash, check, bank transfer). Pre-filled with the full
 * balance since "they paid in full" is the common case; the server decides
 * whether the result is Partial or Paid from the amount, and refuses
 * anything above the balance.
 */
export function RecordPaymentModal({
  open,
  onClose,
  brand,
  invoice,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  brand: Brand;
  invoice: InvoiceDetail;
  onRecorded: () => void;
}) {
  const currency = toCurrencyCode(invoice.currency);
  const exponent = minorUnitExponent(currency);
  const balanceDecimal = (invoice.balanceMinor / 10 ** exponent).toFixed(exponent);

  const [amount, setAmount] = useState(balanceDecimal);
  const [method, setMethod] = useState<ManualPaymentInput['method']>('MANUAL');
  const [paidAt, setPaidAt] = useState(todayLocal);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const amountValue = Number(amount);
  const amountValid =
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) &&
    amountValue > 0 &&
    Math.round(amountValue * 10 ** exponent) <= invoice.balanceMinor;
  const clearsBalance =
    amountValid && Math.round(amountValue * 10 ** exponent) === invoice.balanceMinor;

  function handleClose() {
    if (saving) return;
    setAmount(balanceDecimal);
    setMethod('MANUAL');
    setPaidAt(todayLocal());
    setReference('');
    setError(null);
    onClose();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid || saving) return;
    setSaving(true);
    setError(null);
    const result = await recordInvoicePaymentAction(brand.id, invoice.id, {
      amount: amount.trim(),
      method,
      paidAt,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(
      result.data.status === 'PAID' ? 'Invoice marked as paid' : 'Partial payment recorded',
    );
    onRecorded();
    handleClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-title"
      onClick={handleClose}
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-[520px] rounded-2xl bg-white p-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="record-payment-title" className="text-2xl font-bold text-[#0F172A]">
              Record Payment
            </h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Invoice {invoice.number} · Balance due{' '}
              {formatMinorForDisplay(invoice.balanceMinor, currency)}
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

        <div className="mt-5 space-y-4 border-t border-[#E5E7EB] pt-5">
          {error && (
            <div className="rounded-md bg-danger-surface p-3 text-sm text-danger">{error}</div>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-strong">
              Amount received ({currency})
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={INPUT_CLASS}
              aria-invalid={!amountValid}
            />
            {!amountValid && amount.trim() !== '' && (
              <span className="mt-1 block text-xs text-danger">
                Enter an amount greater than zero and no more than the balance due.
              </span>
            )}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-strong">Method</span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as ManualPaymentInput['method'])}
                className={INPUT_CLASS}
              >
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-strong">Payment date</span>
              <input
                type="date"
                value={paidAt}
                max={todayLocal()}
                onChange={(event) => setPaidAt(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-strong">
              Reference (optional)
            </span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={200}
              placeholder="Check number, transfer ID, note…"
              className={INPUT_CLASS}
            />
          </label>

          {amountValid && (
            <p className="text-sm text-[#64748B]">
              The invoice will be marked{' '}
              <span className="font-semibold text-[#0F172A]">
                {clearsBalance ? 'Paid' : 'Partial'}
              </span>
              .
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-[#E5E7EB] pt-5">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="inline-flex h-11 items-center rounded-lg border border-[#D4D4D4] bg-white px-5 text-sm
                       font-bold text-[#0F172A] transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!amountValid || !paidAt || saving}
            className="inline-flex h-11 items-center rounded-lg bg-black px-5 text-sm font-bold text-white
                       transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#D4D4D4]
                       disabled:text-[#94A3B8]"
          >
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
