'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AlertTriangle, FileClock, RefreshCw } from 'lucide-react';
import { retrySyncJobAction } from '../../app/(app)/dashboard-actions';
import type { NeedsAttentionItem, NeedsAttentionResult } from '@/lib/api';

const DETAIL_TONE: Record<NeedsAttentionItem['kind'], string> = {
  STALE_DRAFT: 'text-ink-subtle',
  DUE_SOON: 'text-warning',
  SYNC_FAILED: 'text-danger',
};

const ICON: Record<NeedsAttentionItem['kind'], typeof AlertTriangle> = {
  STALE_DRAFT: FileClock,
  DUE_SOON: FileClock,
  SYNC_FAILED: AlertTriangle,
};

function RetryButton({ syncJobId }: { syncJobId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await retrySyncJobAction(syncJobId);
            if (!result.ok) setError(result.error);
          })
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-ink-strong px-3 py-1.5 text-xs font-semibold text-ink-inverse hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} aria-hidden />
        {pending ? 'Retrying…' : 'Retry'}
      </button>
      {error && <span className="max-w-[160px] text-right text-[11px] text-danger">{error}</span>}
    </div>
  );
}

export function NeedsAttention({
  result,
  brandId,
}: {
  result: NeedsAttentionResult;
  /** Concrete brand for the "View" link's query string — falls back to the
   * item's own brand in All Brands mode, where there is no single active one. */
  brandId: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-ink-strong">Needs Attention</h2>
          <p className="text-xs text-ink-subtle">Drafts, upcoming dues, sync failures</p>
        </div>
        {result.totalCount > 0 && (
          <span className="text-xs font-semibold text-danger">
            {result.totalCount} item{result.totalCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {result.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-subtle">Nothing needs attention.</p>
      ) : (
        <ul className="space-y-3">
          {result.items.map((item, index) => {
            const Icon = ICON[item.kind];
            const targetBrandId = brandId ?? item.brandId;
            return (
              <li
                key={`${item.kind}-${item.syncJobId ?? item.invoiceId ?? index}`}
                className="flex items-start gap-3"
              >
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"
                  aria-hidden
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-strong">
                    {item.invoiceNumber ? `${item.invoiceNumber}  ` : ''}
                    {item.subject}
                    {item.brandName && (
                      <span className="ml-2 text-xs font-normal text-ink-subtle">
                        {item.brandName}
                      </span>
                    )}
                  </p>
                  <p className={`text-xs ${DETAIL_TONE[item.kind]}`}>{item.detail}</p>
                </div>

                {item.kind === 'SYNC_FAILED' && item.syncJobId ? (
                  <RetryButton syncJobId={item.syncJobId} />
                ) : item.invoiceNumber ? (
                  <Link
                    href={`/invoices?brandId=${targetBrandId}&search=${encodeURIComponent(item.invoiceNumber)}`}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink-strong hover:bg-surface-muted"
                  >
                    View
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
