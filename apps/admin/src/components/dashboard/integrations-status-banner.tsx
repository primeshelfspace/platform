import Link from 'next/link';
import { CircleCheck, Link2 } from 'lucide-react';

/**
 * Two states, not one dimmed-down version of the other: connected shows
 * live sync status plus a shortcut to whatever needs attention; not
 * connected is a call to action, not a status readout with nothing to say.
 */
export function IntegrationsStatusBanner({
  connected,
  lastSyncAt,
  needsAttentionCount,
  connectHref,
}: {
  connected: boolean;
  lastSyncAt: string | null;
  needsAttentionCount: number;
  /** Where "Connect Now" sends the merchant — always a concrete brand, even
   * in All Brands mode (Brand Settings has no aggregate view of its own). */
  connectHref: string;
}) {
  if (!connected) {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info-surface px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-info">
          <Link2 className="h-4 w-4" aria-hidden />
          Connect Integrations and Payment Gateway to start tracking invoices and payments.
        </span>
        <Link
          href={connectHref}
          className="shrink-0 rounded-md bg-ink-strong px-4 py-1.5 text-xs font-semibold text-ink-inverse hover:opacity-90"
        >
          Connect Now
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-ink-muted">
        <CircleCheck className="h-4 w-4 text-success" aria-hidden />
        Zoho Books &amp; Stripe: Connected
        {lastSyncAt && (
          <span className="text-ink-subtle">
            · Last synced {new Date(lastSyncAt).toLocaleString()}
          </span>
        )}
      </span>
      {needsAttentionCount > 0 && (
        <a href="#needs-attention" className="font-medium text-danger hover:underline">
          {needsAttentionCount} item{needsAttentionCount === 1 ? '' : 's'} need attention →
        </a>
      )}
    </div>
  );
}
