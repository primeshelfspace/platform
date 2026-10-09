'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Eye, X } from 'lucide-react';
import { toast } from '@sugrpay/ui/toast';
import { formatDateForDisplay } from '@sugrpay/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@sugrpay/shared/money';
import type { CheckSubmissionDetail } from '@/lib/api';
import { useCan } from '@/hooks/use-permissions';
import {
  approveCheckSubmissionAction,
  getCheckSubmissionDetailAction,
  rejectCheckSubmissionAction,
} from './actions';

const STATUS_BADGE: Record<
  CheckSubmissionDetail['status'],
  { dot: string; text: string; pill: string; label: string }
> = {
  PENDING: {
    dot: 'bg-warning',
    text: 'text-warning',
    pill: 'bg-warning-surface',
    label: 'Pending Verification',
  },
  APPROVED: {
    dot: 'bg-success',
    text: 'text-success',
    pill: 'bg-success-surface',
    label: 'Approved',
  },
  REJECTED: { dot: 'bg-danger', text: 'text-danger', pill: 'bg-danger-surface', label: 'Rejected' },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-ink-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-ink-strong">{children}</div>
    </div>
  );
}

/** Payments > Check Verifications' "Review" drawer — view the submitted
 * check (front/back, the customer's claimed amount and note) and record a
 * decision. One shared "Internal Notes" field feeds whichever action is
 * clicked: Approve sends it along as an optional note, Reject requires it be
 * non-empty (ChecksService.reject's own rule — enforced here first so the
 * round trip isn't needed just to find that out). Approve creates a real
 * settled payment against the linked invoice (reusing
 * InvoicesService.recordManualPayment); reject just closes the row out.
 * Owns its own fetch — unlike InvoiceDetailDrawer, nothing else on this page
 * needs this row's detail, so there's no reason to thread it through the
 * page client. */
export function CheckReviewDrawer({
  open,
  onClose,
  brandId,
  checkId,
  onReviewed,
}: {
  open: boolean;
  onClose: () => void;
  brandId: string;
  checkId: string | null;
  /** Called after a successful approve/reject — the parent re-fetches the
   * list rather than this drawer patching it in place. */
  onReviewed: () => void;
}) {
  const [detail, setDetail] = useState<CheckSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);
  const [previewSide, setPreviewSide] = useState<'Front' | 'Back' | null>(null);
  const canReview = useCan('CHECK_APPROVAL', 'APPROVE');

  useEffect(() => {
    if (!open || !checkId) return;
    setDetail(null);
    setError(null);
    setNote('');
    setPreviewSide(null);
    setLoading(true);
    getCheckSubmissionDetailAction(brandId, checkId)
      .then((result) => {
        if (result.ok) setDetail(result.data);
        else setError(result.error);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not load this check.'),
      )
      .finally(() => setLoading(false));
  }, [open, checkId, brandId]);

  if (!open) return null;

  async function submit(decision: 'approve' | 'reject') {
    if (!detail || submitting) return;
    if (decision === 'reject' && !note.trim()) {
      toast.error('A reason is required to reject a check.');
      return;
    }
    setSubmitting(decision);
    const action =
      decision === 'approve' ? approveCheckSubmissionAction : rejectCheckSubmissionAction;
    const result = await action(brandId, detail.id, { note: note.trim() || undefined });
    setSubmitting(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(decision === 'approve' ? 'Check approved' : 'Check rejected');
    onReviewed();
  }

  const badge = detail ? STATUS_BADGE[detail.status] : null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />

      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 px-8 py-6">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">Check #</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-ink-strong">
                {detail?.checkNumber ?? (loading ? 'Loading…' : 'Check')}
              </h2>
              {badge && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.pill}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden />
                  <span className={badge.text}>{badge.label}</span>
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink-strong"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 px-8 pb-6">
          {error ? (
            <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
              <p className="font-medium">Could not load this check.</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          ) : loading || !detail ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-16 gap-y-6">
                <Field label="Check #">{detail.checkNumber}</Field>
                <Field label="Customer">
                  <Link
                    href={`/customers?brandId=${brandId}&search=${encodeURIComponent(detail.customerName)}`}
                    className="font-semibold text-[#2563EB] hover:underline"
                  >
                    {detail.customerName}
                  </Link>
                </Field>
                <Field label="Amount">
                  {formatMinorForDisplay(detail.amountMinor, toCurrencyCode(detail.currency))}
                </Field>
                <Field label="Uploaded On">{formatDateForDisplay(detail.createdAt)}</Field>
              </div>

              {detail.customerNote && (
                <div className="mt-6">
                  <Field label="Customer Notes">
                    <p className="font-normal text-ink-strong">{detail.customerNote}</p>
                  </Field>
                </div>
              )}

              <hr className="my-6 border-border" />

              <h3 className="text-base font-bold text-ink-strong">Check Images</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                {(
                  [
                    { label: 'Front', url: detail.frontImageUrl },
                    { label: 'Back', url: detail.backImageUrl },
                  ] as const
                ).map((side) => (
                  <div key={side.label}>
                    <p className="text-sm text-ink-muted">{side.label}</p>
                    <button
                      type="button"
                      onClick={() => setPreviewSide(side.label)}
                      className="group relative mt-1 block w-full overflow-hidden rounded-lg border border-border"
                    >
                      <img
                        src={side.url}
                        alt={`${side.label} of check`}
                        className="aspect-[16/9] w-full object-cover"
                      />
                      <span
                        className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 -translate-x-1/2 -translate-y-1/2
                                   items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#D4D4D4] bg-white
                                   px-3 text-xs font-semibold text-[#404040] opacity-0 shadow-[0_1px_2px_rgba(0,0,0,0.05)]
                                   transition-opacity group-hover:opacity-100"
                      >
                        <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                        Preview
                      </span>
                    </button>
                  </div>
                ))}
              </div>

              <hr className="my-6 border-border" />

              {detail.status === 'PENDING' && canReview ? (
                <div>
                  <h3 className="text-base font-bold text-ink-strong">Internal Notes</h3>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    placeholder="Add internal notes about this check review."
                    className="mt-2 w-full rounded-lg border border-[#D4D4D4] bg-white p-3 text-sm text-ink-strong
                               placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  />
                </div>
              ) : (
                detail.reviewNote && (
                  <Field label={detail.status === 'REJECTED' ? 'Rejection Reason' : 'Review Note'}>
                    <p className="font-normal text-ink-strong">{detail.reviewNote}</p>
                  </Field>
                )
              )}
            </>
          )}
        </div>

        {detail && detail.status === 'PENDING' && canReview && (
          <div className="flex gap-3 border-t border-border px-8 py-5">
            <button
              type="button"
              onClick={() => void submit('reject')}
              disabled={submitting !== null}
              className="h-12 flex-1 rounded-[10px] border border-danger bg-white text-sm font-bold text-danger
                         transition-colors hover:bg-danger-surface disabled:opacity-60"
            >
              {submitting === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              type="button"
              onClick={() => void submit('approve')}
              disabled={submitting !== null}
              className="h-12 flex-1 rounded-[10px] bg-success text-sm font-bold text-white
                         transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {submitting === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </div>

      {previewSide &&
        detail &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${previewSide} of check ${detail.checkNumber}, full size`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            onClick={() => setPreviewSide(null)}
          >
            <div
              className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 bg-[#1F2430] px-8 py-5">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-white">
                    Check #: {detail.checkNumber}
                  </h2>
                  <p className="truncate text-sm text-[#9CA3AF]">{detail.customerName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-1 rounded-full bg-[#2A3140] p-1">
                    {(['Front', 'Back'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setPreviewSide(side)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                          previewSide === side
                            ? 'bg-white text-[#111827]'
                            : 'text-[#9CA3AF] hover:text-white'
                        }`}
                      >
                        {side}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewSide(null)}
                    aria-label="Close preview"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2A3140] text-white hover:bg-[#3A4253]"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center bg-black p-10">
                <img
                  src={previewSide === 'Front' ? detail.frontImageUrl : detail.backImageUrl}
                  alt={`${previewSide} of check ${detail.checkNumber}, full size`}
                  className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-lg"
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>,
    document.body,
  );
}
