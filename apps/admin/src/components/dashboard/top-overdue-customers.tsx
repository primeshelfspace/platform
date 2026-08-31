import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { TopOverdueCustomer } from '@/lib/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** A small, deterministic palette for avatar backgrounds — cosmetic only, not
 * a data encoding, so it does not need to follow the categorical-hue rules a
 * real series colour would. */
const AVATAR_TONES = ['bg-info', 'bg-accent', 'bg-warning', 'bg-danger', 'bg-success'];

export function TopOverdueCustomers({
  customers,
  currency,
}: {
  customers: TopOverdueCustomer[];
  currency: string;
}) {
  const code = toCurrencyCode(currency);
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-ink-strong">Top Overdue Customers</h2>
          <p className="text-xs text-ink-subtle">Sorted by amount</p>
        </div>
        <span className="text-xs text-ink-subtle">{customers.length} customers</span>
      </div>

      {customers.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-subtle">Nothing overdue.</p>
      ) : (
        <ul className="space-y-1">
          {customers.map((customer, index) => (
            <li
              key={customer.customerId}
              className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-surface-muted"
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${AVATAR_TONES[index % AVATAR_TONES.length]}`}
                aria-hidden
              >
                {initials(customer.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-strong">
                  {customer.displayName}
                  {customer.brandName && (
                    <span className="ml-2 text-xs font-normal text-ink-subtle">
                      {customer.brandName}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-subtle">
                  {customer.daysOverdue} day{customer.daysOverdue === 1 ? '' : 's'} overdue
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-danger">
                {formatMinorForDisplay(customer.balanceMinor, code)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
