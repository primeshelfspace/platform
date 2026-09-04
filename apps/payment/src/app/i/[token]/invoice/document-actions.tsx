import Link from 'next/link';
import { API_URL } from '@/lib/env';
import { ArrowLeftIcon, DownloadIcon } from '../icons';

/**
 * The invoice document's on-screen toolbar: back to the payment page, and
 * "Download invoice" — the same API PDF endpoint the payment page's own
 * "Download invoice" link uses, so this stays consistent with it.
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
      <a
        href={`${API_URL}/public/invoices/${token}/pdf`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-semibold text-ink-strong transition-colors hover:bg-surface-muted"
      >
        <DownloadIcon className="h-4 w-4" />
        Download invoice
      </a>
    </div>
  );
}
