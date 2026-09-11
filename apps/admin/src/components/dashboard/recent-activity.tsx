import { Activity, CreditCard, ScrollText, UserPen, UserPlus } from 'lucide-react';
import type { RecentActivityItem } from '@/lib/api';

const ICON: Record<RecentActivityItem['kind'], typeof ScrollText> = {
  PAYMENT_RECEIVED: CreditCard,
  INVOICE_SENT: ScrollText,
  CUSTOMER_ADDED: UserPlus,
  CUSTOMER_UPDATED: UserPen,
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="mb-4 font-medium text-ink-strong">Recent Activity</h2>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Activity className="h-8 w-8 text-ink-subtle" aria-hidden />
          <p className="text-sm text-ink-subtle">No activity recorded yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => {
            const Icon = ICON[item.kind];
            return (
              <li key={index} className="flex items-center gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-ink-strong">
                  {item.message}
                  {item.brandName && (
                    <span className="ml-2 text-xs font-normal text-ink-subtle">
                      {item.brandName}
                    </span>
                  )}
                </p>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {relativeTime(item.occurredAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
