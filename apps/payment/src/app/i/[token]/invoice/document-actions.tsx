'use client';

import Link from 'next/link';
import { ArrowLeftIcon, DownloadIcon } from '../icons';

/**
 * The invoice document's on-screen toolbar: back to the payment page, and
 * "Download invoice".
 *
 * Download is `window.print()`, deliberately. There is no PDF renderer in
 * this system — both of the admin's own "Download PDF" buttons are disabled
 * with `title="PDF generation isn't built yet"` — so a button that streamed a
 * .pdf would be a button that lied. The browser's print dialog has "Save as
 * PDF" in it on every platform we target, and the print rules in globals.css
 * lay this page out for paper (toolbar dropped, page chrome removed, brand
 * colours kept), so what it saves is the document as designed. If server-side
 * PDF generation is built later, this is the one call site that changes.
 *
 * A client component only because `onClick` needs one; nothing about the
 * document itself is client-rendered.
 */
export function DocumentActions({ token }: { token: string }) {
  return (
    <div className="print-hide mb-4 flex items-center justify-between">
      <Link
        href={`/i/${token}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink-strong"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to payment
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-semibold text-ink-strong transition-colors hover:bg-surface-muted"
      >
        <DownloadIcon className="h-4 w-4" />
        Download invoice
      </button>
    </div>
  );
}
