import { Users } from 'lucide-react';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { TopOverdueCustomer } from '@/lib/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** A single solid tone for every avatar — cosmetic only, not a data
 * encoding, so all five customers read as one consistent list rather than a
 * cycling rainbow. */
const AVATAR_TONE = 'bg-ink-strong';

export function TopOverdueCustomers({
  customers,
  currency,
}: {
  customers: TopOverdueCustomer[];
  currency: string;
}) {
  const code = toCurrencyCode(currency);
  return (
    <div className="rounded-[14px] border border-[#E5E5E5] bg-surface p-8 shadow-[0px_1px_3px_0px_#0000000A]">
      <div className="mb-5">
        <div className="flex items-center justify-between pb-5">
          <div>
            <h2 className="text-lg font-semibold leading-none text-ink-strong">
              Top Overdue Customers
            </h2>
            <p
              className="mt-1 text-[12px] font-medium leading-none tracking-normal text-ink-subtle"
              style={{ fontFamily: 'var(--font-jakarta)' }}
            >
              Sorted by amount — click row for detail
            </p>
          </div>
          {customers.length > 0 && (
            <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold text-ink-muted">
              {customers.length} customer{customers.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {/* Full-bleed to the card's own edge — cancels the card's p-8 so the
            line reaches both sides, rather than stopping at the padding. */}
        <div className="-mx-8 border-b border-[#E5E5E5]" />
      </div>

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Users className="h-8 w-8 text-ink-subtle" aria-hidden />
          <p className="text-sm text-ink-subtle">No overdue customers.</p>
        </div>
      ) : (
        <ul className="-mx-8 divide-y divide-[#E5E5E5]">
          {customers.map((customer) => (
            <li
              key={customer.customerId}
              className="flex items-center gap-3 px-8 py-5 first:pt-0 last:pb-0"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${AVATAR_TONE}`}
                aria-hidden
              >
                {initials(customer.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink-strong">
                  {customer.displayName}
                  {customer.brandName && (
                    <span className="ml-2 text-xs font-normal text-ink-subtle">
                      {customer.brandName}
                    </span>
                  )}
                </p>
                <p className="text-sm text-ink-subtle">
                  {customer.daysOverdue} day{customer.daysOverdue === 1 ? '' : 's'} overdue
                </p>
              </div>
              <span className="shrink-0 text-lg font-bold text-danger">
                {formatMinorForDisplay(customer.balanceMinor, code)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
