'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/env';

/** Mirrors apps/api/src/common/check-upload.ts's own limit — client-side
 * validation is a convenience (fail before the upload even starts), not the
 * enforcement; the API re-checks both independently. */
const MAX_CHECK_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CHECK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface ImageFieldState {
  file: File | null;
  error: string | null;
}

const EMPTY_IMAGE: ImageFieldState = { file: null, error: null };

function validateImage(file: File): string | null {
  if (!ALLOWED_CHECK_IMAGE_TYPES.includes(file.type)) {
    return 'Please upload a JPG, PNG, or WEBP image.';
  }
  if (file.size > MAX_CHECK_IMAGE_BYTES) {
    return 'Image must be 10MB or smaller.';
  }
  return null;
}

/**
 * The "Upload Check" block of the payment page, mounted the moment that tile
 * is selected — shaped like StripeCardForm (its own fields, its own submit
 * button, its own loading/error state) but posts multipart form data to
 * POST /public/invoices/:token/checks instead of going through PaymentForm's
 * createIntent/submitNonCard: there is no payment-gateway attempt for this
 * method, only a row for staff to review (ChecksService / the admin's
 * check-review-drawer.tsx already read from this same table).
 *
 * A failed submit stays inline (formError) rather than replacing the whole
 * form the way StripeCardForm's onError does — re-selecting photos and
 * retyping the check number after a transient network error would be a much
 * worse retry than just trying the same submit again.
 */
export function CheckUploadForm({
  token,
  accentColor,
  amountLabel,
  onSubmitted,
}: {
  token: string;
  accentColor: string;
  amountLabel: string;
  onSubmitted: () => void;
}) {
  const [checkNumber, setCheckNumber] = useState('');
  const [note, setNote] = useState('');
  const [front, setFront] = useState<ImageFieldState>(EMPTY_IMAGE);
  const [back, setBack] = useState<ImageFieldState>(EMPTY_IMAGE);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function pickImage(
    event: React.ChangeEvent<HTMLInputElement>,
    setState: (state: ImageFieldState) => void,
  ) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setState(EMPTY_IMAGE);
      return;
    }
    const error = validateImage(file);
    setState({ file: error ? null : file, error });
    if (error) event.target.value = '';
  }

  const canSubmit = checkNumber.trim().length > 0 && front.file && back.file && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!front.file || !back.file) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const formData = new FormData();
      formData.set('checkNumber', checkNumber.trim());
      if (note.trim()) formData.set('customerNote', note.trim());
      formData.set('front', front.file);
      formData.set('back', back.file);

      const response = await fetch(`${API_URL}/public/invoices/${token}/checks`, {
        method: 'POST',
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Something went wrong.');

      onSubmitted();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The network request failed.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-5">
      <p className="text-sm font-bold text-ink-strong">Check details</p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Check number</span>
          <input
            value={checkNumber}
            onChange={(event) => setCheckNumber(event.target.value)}
            placeholder="1234"
            className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-ink-strong
                       shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors placeholder:text-slate-400
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong
                       focus-visible:ring-offset-1"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Front of check</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => pickImage(event, setFront)}
              className="block w-full text-xs text-ink-muted file:mr-2 file:rounded-md file:border-0
                         file:bg-surface-muted file:px-3 file:py-2 file:text-xs file:font-semibold
                         file:text-ink-strong"
            />
            {front.error && <p className="mt-1 text-xs text-danger">{front.error}</p>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Back of check</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => pickImage(event, setBack)}
              className="block w-full text-xs text-ink-muted file:mr-2 file:rounded-md file:border-0
                         file:bg-surface-muted file:px-3 file:py-2 file:text-xs file:font-semibold
                         file:text-ink-strong"
            />
            {back.error && <p className="mt-1 text-xs text-danger">{back.error}</p>}
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Note (optional)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="e.g. Mailed on the 1st"
            className="w-full rounded-lg border border-[#D4D4D4] bg-white p-3 text-sm text-ink-strong
                       placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-ink-strong focus-visible:ring-offset-1"
          />
        </label>
      </div>

      {formError && <p className="mt-3 text-xs text-danger">{formError}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{ backgroundColor: accentColor }}
        className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : `Submit check for ${amountLabel}`}
      </button>
    </form>
  );
}
