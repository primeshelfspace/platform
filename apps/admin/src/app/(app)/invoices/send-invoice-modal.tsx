'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Eye, Pencil, X } from 'lucide-react';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { Brand, InvoiceDetail } from '@/lib/api';
import { getInvoiceEmailDraftAction, issueInvoiceAction, sendInvoiceEmailAction } from './actions';

const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

// Deliberately not RFC-5322-exact — same tradeoff every other email field in
// this app makes (the server's emailSchema is the real gate; this is just
// fast enough feedback to not submit an obvious typo).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

type ComposeError =
  | { kind: 'no-email'; message: string }
  | { kind: 'invalid-email'; message: string }
  | { kind: 'invalid-cc'; message: string }
  | { kind: 'send-failed'; message: string };

/**
 * The rendered email — a simplified, non-editable version of
 * EmailReceiptEditor's own PreviewBody (brand-settings/email-receipt-editor.tsx):
 * no layout/theme switching (this is one real send, not a template being
 * designed), and no variable-highlighting (to/subject/body here are already
 * fully substituted text, not a template with {{}} placeholders — nothing
 * left to highlight).
 */
function EmailPreview({
  brand,
  subject,
  body,
  invoice,
  viewUrl,
}: {
  brand: Brand;
  subject: string;
  body: string;
  invoice: InvoiceDetail;
  viewUrl: string;
}) {
  const currency = toCurrencyCode(invoice.currency);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
      <div style={{ backgroundColor: brand.themeColor }} className="h-1.5 w-full" aria-hidden />
      <div className="flex items-center gap-3 border-b border-[#E5E7EB] px-6 py-5">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
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
        <span className="block text-base font-bold text-ink-strong">{brand.displayName}</span>
      </div>

      <div className="p-6">
        <p className="text-base font-bold text-ink-strong">{subject}</p>
        <div className="mt-3 space-y-3 text-sm text-ink-muted">
          {body
            .split('\n')
            .map((line, index) =>
              line.trim() ? (
                <p key={index}>{line}</p>
              ) : (
                <div key={index} className="h-1" aria-hidden />
              ),
            )}
        </div>

        <a
          href={viewUrl}
          onClick={(event) => event.preventDefault()}
          className="mt-5 block w-full rounded-lg bg-black px-5 py-3.5 text-center text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          View &amp; Pay Invoice
        </a>

        <div className="mt-6 overflow-hidden rounded-lg border border-[#E5E7EB]">
          <p className="bg-surface-muted px-4 py-2.5 text-sm font-bold text-ink-strong">
            Invoice summary
          </p>
          <dl className="divide-y divide-[#E5E7EB] text-sm">
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Invoice number</dt>
              <dd className="font-bold text-ink-strong">{invoice.number}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Amount due</dt>
              <dd className="font-bold text-ink-strong">
                {formatMinorForDisplay(invoice.balanceMinor, currency)}
              </dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Due date</dt>
              <dd className="font-bold text-ink-strong">{formatDateForDisplay(invoice.dueDate)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

export function SendInvoiceModal({
  open,
  onClose,
  brand,
  invoice,
  isFirstSend,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  brand: Brand;
  invoice: InvoiceDetail;
  /** Draft only — a first send transitions Draft → Sent (issueInvoiceAction)
   * before the email itself goes out; a resend just sends. */
  isFirstSend: boolean;
  /** Called once the email has actually gone out, so the drawer behind this
   * modal can refresh (the invoice's own status, if this was a first send). */
  onSent: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'compose' | 'preview'>('compose');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [composeError, setComposeError] = useState<ComposeError | null>(null);
  const [sending, setSending] = useState(false);

  // Fresh every time this opens — an Email Receipt template edited, or a
  // customer email added, since the drawer itself first loaded should show
  // up here too (see getInvoiceEmailDraftAction's own comment).
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setView('compose');
    setComposeError(null);
    setCc('');
    getInvoiceEmailDraftAction(brand.id, invoice.id)
      .then((result) => {
        if (result.ok) {
          setTo(result.data.to);
          setSubject(result.data.subject);
          setBody(result.data.body);
          if (!result.data.to) {
            setComposeError({
              kind: 'no-email',
              message: 'This customer has no email on file. Enter one below to send this invoice.',
            });
          }
        } else {
          setLoadError(result.error);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice.id]);

  if (!open) return null;

  const viewUrl = `${PAYMENT_PUBLIC_URL}/i/${invoice.publicToken}`;
  const sendLabel = isFirstSend ? 'Send Invoice' : 'Resend Invoice';

  async function handleSend() {
    const trimmedTo = to.trim();
    if (!trimmedTo) {
      setComposeError({
        kind: 'no-email',
        message: 'This customer has no email on file. Enter one below to send this invoice.',
      });
      return;
    }
    if (!EMAIL_RE.test(trimmedTo)) {
      setComposeError({ kind: 'invalid-email', message: 'Enter a valid email address.' });
      return;
    }
    const trimmedCc = cc.trim();
    if (trimmedCc && !EMAIL_RE.test(trimmedCc)) {
      setComposeError({ kind: 'invalid-cc', message: 'Enter a valid CC email address.' });
      return;
    }

    setSending(true);
    setComposeError(null);

    if (isFirstSend) {
      const issueResult = await issueInvoiceAction(brand.id, invoice.id);
      if (!issueResult.ok) {
        setSending(false);
        setComposeError({ kind: 'send-failed', message: issueResult.error });
        return;
      }
    }

    const result = await sendInvoiceEmailAction(brand.id, invoice.id, {
      to: trimmedTo,
      cc: trimmedCc,
      subject,
      body,
    });
    setSending(false);
    if (result.ok) {
      onSent();
      onClose();
    } else {
      setComposeError({ kind: 'send-failed', message: result.error });
    }
  }

  const toHasError = composeError?.kind === 'no-email' || composeError?.kind === 'invalid-email';
  const ccHasError = composeError?.kind === 'invalid-cc';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">
              {isFirstSend ? 'Sending Invoice' : 'Resending Invoice'}
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-ink-strong">
              {invoice.number} to {invoice.customer.displayName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted
                       transition-colors hover:bg-[#F5F5F6] hover:text-ink-strong"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="skeleton-fade-in space-y-3" aria-hidden>
              <div className="skeleton-block h-4 w-32 rounded bg-surface-muted" />
              <div className="skeleton-block h-24 rounded-lg bg-surface-muted" />
            </div>
          ) : loadError ? (
            <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
              <p className="font-medium">Could not prepare this email.</p>
              <p className="mt-1 font-mono text-xs">{loadError}</p>
            </div>
          ) : view === 'preview' ? (
            <EmailPreview
              brand={brand}
              subject={subject}
              body={body}
              invoice={invoice}
              viewUrl={viewUrl}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-ink-muted">From</span>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                  style={{ backgroundColor: brand.themeColor }}
                  aria-hidden
                >
                  {initialOf(brand.displayName)}
                </span>
                <span className="font-semibold text-ink-strong">{brand.displayName}</span>
              </div>

              {composeError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-danger-surface p-3 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{composeError.message}</span>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-strong">To</span>
                <input
                  type="email"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    if (toHasError) setComposeError(null);
                  }}
                  placeholder="customer@example.com"
                  className={`h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-[0_1px_1px_rgba(0,0,0,0.05)]
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                               toHasError
                                 ? 'border-danger focus-visible:ring-danger'
                                 : 'border-[#D4D4D4] focus-visible:ring-slate-900'
                             }`}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-strong">
                  CC (optional)
                </span>
                <input
                  type="email"
                  value={cc}
                  onChange={(event) => {
                    setCc(event.target.value);
                    if (ccHasError) setComposeError(null);
                  }}
                  placeholder="cc@example.com"
                  className={`h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-[0_1px_1px_rgba(0,0,0,0.05)]
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                               ccHasError
                                 ? 'border-danger focus-visible:ring-danger'
                                 : 'border-[#D4D4D4] focus-visible:ring-slate-900'
                             }`}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-strong">Subject</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900
                             shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-strong">Email Body</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={7}
                  className="w-full rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-sm text-slate-900
                             shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                />
              </label>

              <label
                className="flex cursor-not-allowed items-center gap-2 text-sm text-ink-muted opacity-60"
                title="PDF generation isn't built yet"
              >
                <input type="checkbox" disabled className="h-4 w-4 rounded border-[#D4D4D4]" />
                Attach Invoice PDF
              </label>
            </div>
          )}
        </div>

        {!loading && !loadError && (
          <div className="flex items-center justify-between gap-3 border-t border-[#E5E7EB] px-6 py-4">
            <button
              type="button"
              onClick={() => setView((v) => (v === 'compose' ? 'preview' : 'compose'))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D4D4D4] bg-white px-3
                         text-sm font-bold text-ink-strong transition-colors hover:bg-surface-muted"
            >
              {view === 'compose' ? (
                <>
                  <Eye className="h-4 w-4" aria-hidden />
                  Preview Email
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4" aria-hidden />
                  Back to Edit
                </>
              )}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="inline-flex h-9 items-center rounded-lg border border-[#D4D4D4] bg-white px-4 text-sm
                           font-bold text-ink-strong transition-colors hover:bg-surface-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending}
                className="inline-flex h-9 items-center rounded-lg bg-black px-4 text-sm font-bold text-white
                           transition-colors hover:bg-neutral-800 disabled:opacity-60"
              >
                {sending
                  ? 'Sending…'
                  : composeError?.kind === 'send-failed'
                    ? 'Retry Send'
                    : sendLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
