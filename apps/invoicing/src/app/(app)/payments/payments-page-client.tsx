'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileCheck, Search } from 'lucide-react';
import { Pagination } from '@sugrpay/ui/pagination';
import { formatDateForDisplay } from '@sugrpay/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@sugrpay/shared/money';
import { NoBrandsState } from '@/components/no-brands-state';
import type {
  Brand,
  CheckReviewStatus,
  CheckSubmissionListResponse,
  CheckSubmissionRow,
  PaymentTransactionListResponse,
} from '@/lib/api';
import { TransactionLog } from '../settings/integrations/payment-gateways-panel';
import { CheckReviewDrawer } from './check-review-drawer';

const PAGE_TABS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'checks', label: 'Check Verifications' },
] as const;

const STATUS_PILLS: readonly { key: CheckReviewStatus; label: string }[] = [
  { key: 'PENDING', label: 'Pending Verification' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

const STATUS_BADGE: Record<CheckReviewStatus, { dot: string; text: string; label: string }> = {
  PENDING: { dot: 'bg-warning', text: 'text-warning', label: 'Pending Verification' },
  APPROVED: { dot: 'bg-success', text: 'text-success', label: 'Approved' },
  REJECTED: { dot: 'bg-danger', text: 'text-danger', label: 'Rejected' },
};

const EMPTY_STATE: Record<CheckReviewStatus, { title: string; body: string }> = {
  PENDING: {
    title: 'No checks waiting for verification',
    body: 'New check submissions will show up here as customers upload them.',
  },
  APPROVED: {
    title: 'No approved checks yet',
    body: 'Checks you approve will be listed here, alongside the payment they recorded.',
  },
  REJECTED: {
    title: 'No rejected checks',
    body: 'Checks you reject will be listed here, along with your reason.',
  },
};

export function PaymentsPageClient({
  brand,
  brandsError,
  hasBrands,
  tab,
  transactions,
  checkSubmissions,
  checkStatus,
  checkSearch,
  dataError,
}: {
  brand: Brand | null;
  brandsError: string | null;
  hasBrands: boolean;
  tab: 'transactions' | 'checks';
  transactions: PaymentTransactionListResponse | null;
  checkSubmissions: CheckSubmissionListResponse | null;
  checkStatus: CheckReviewStatus;
  checkSearch: string;
  dataError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(checkSearch);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  function pushParams(next: Record<string, string | null>) {
    const query = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') query.delete(key);
      else query.set(key, value);
    }
    router.push(`${pathname}?${query.toString()}`);
  }

  function onTabChange(nextTab: (typeof PAGE_TABS)[number]['key']) {
    pushParams({ tab: nextTab === 'transactions' ? null : nextTab });
  }

  function onStatusPillChange(status: CheckReviewStatus) {
    pushParams({ checkStatus: status === 'PENDING' ? null : status, checkPage: null });
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushParams({ checkSearch: searchTerm.trim() || null, checkPage: null });
  }

  function onCheckPageChange(nextPage: number) {
    pushParams({ checkPage: nextPage === 1 ? null : String(nextPage) });
  }

  function onCheckPageSizeChange(nextPageSize: number) {
    pushParams({ checkPageSize: String(nextPageSize), checkPage: null });
  }

  function onReviewed() {
    setReviewingId(null);
    router.refresh();
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-[28px] font-bold text-[#0F172A]">Payments</h1>
        <p className="mt-1 text-[15px] text-[#64748B]">
          Track every payment for this brand and verify checks before they&rsquo;re applied to
          invoices.
        </p>
      </header>

      {brandsError ? (
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
          <p className="font-medium">Could not load brands.</p>
          <p className="mt-1 font-mono text-xs">{brandsError}</p>
        </div>
      ) : !hasBrands ? (
        <NoBrandsState />
      ) : (
        <>
          <div className="mb-5 flex items-center gap-6 border-b border-[#E5E7EB]">
            {PAGE_TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTabChange(t.key)}
                  aria-current={active ? 'true' : undefined}
                  className={`border-b-2 px-1 pb-3 text-sm transition-colors ${
                    active
                      ? 'border-[#0F172A] font-bold text-[#0F172A]'
                      : 'border-transparent font-medium text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {dataError ? (
            <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
              <p className="font-medium">Could not load this tab.</p>
              <p className="mt-1 font-mono text-xs">{dataError}</p>
            </div>
          ) : !brand ? null : tab === 'transactions' ? (
            transactions && <TransactionLog brandId={brand.id} initial={transactions} />
          ) : (
            <section className="rounded-xl border border-border bg-surface shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  {STATUS_PILLS.map((pill) => {
                    const active = pill.key === checkStatus;
                    return (
                      <button
                        key={pill.key}
                        type="button"
                        onClick={() => onStatusPillChange(pill.key)}
                        aria-current={active ? 'true' : undefined}
                        className={`h-9 shrink-0 rounded-full px-4 text-sm font-bold transition-colors ${
                          active
                            ? 'bg-black text-white'
                            : 'border border-[#D4D4D4] bg-white text-[#0F172A] hover:bg-surface-muted'
                        }`}
                      >
                        {pill.label}
                      </button>
                    );
                  })}
                </div>

                <form onSubmit={onSearchSubmit} className="relative w-full max-w-xs sm:w-60">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                    aria-hidden
                  />
                  <input
                    type="search"
                    aria-label="Search checks by check number, customer, or invoice"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search"
                    className="h-9 w-full rounded-lg border border-[#D4D4D4] bg-white pl-9 pr-3 text-sm text-[#0F172A]
                               placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  />
                </form>
              </div>

              {!checkSubmissions || checkSubmissions.data.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center">
                  <FileCheck className="h-8 w-8 text-ink-subtle" aria-hidden />
                  <p className="font-medium text-ink-strong">{EMPTY_STATE[checkStatus].title}</p>
                  <p className="text-sm text-ink-muted">
                    {checkSearch
                      ? 'No check submission matches this search.'
                      : EMPTY_STATE[checkStatus].body}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Check submissions awaiting verification</caption>
                    <thead>
                      <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        <th scope="col" className="px-5 py-3 sm:px-6">
                          Check #
                        </th>
                        <th scope="col" className="px-5 py-3">
                          Customer
                        </th>
                        <th scope="col" className="px-5 py-3">
                          Amount
                        </th>
                        <th scope="col" className="px-5 py-3">
                          Uploaded On
                        </th>
                        <th scope="col" className="px-5 py-3">
                          Status
                        </th>
                        <th scope="col" className="px-5 py-3 sm:pr-6">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {checkSubmissions.data.map((row: CheckSubmissionRow) => {
                        const badge = STATUS_BADGE[row.status];
                        return (
                          <tr key={row.id}>
                            <td className="whitespace-nowrap px-5 py-3 font-bold text-ink-strong sm:px-6">
                              {row.checkNumber}
                            </td>
                            <td className="px-5 py-3 text-ink-strong">{row.customerName}</td>
                            <td className="whitespace-nowrap px-5 py-3 font-bold text-ink-strong">
                              {formatMinorForDisplay(row.amountMinor, toCurrencyCode(row.currency))}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                              {formatDateForDisplay(row.createdAt)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3">
                              <span className="inline-flex items-center gap-1.5">
                                <span className={`h-2 w-2 rounded-full ${badge.dot}`} aria-hidden />
                                <span className={`font-medium ${badge.text}`}>{badge.label}</span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-right sm:pr-6">
                              <button
                                type="button"
                                onClick={() => setReviewingId(row.id)}
                                className="inline-flex h-8 items-center rounded-lg bg-black px-3.5 text-xs
                                           font-bold text-white transition-colors hover:bg-neutral-800"
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <Pagination
                page={checkSubmissions?.page ?? 1}
                pageSize={checkSubmissions?.pageSize ?? 25}
                total={checkSubmissions?.total ?? 0}
                onPageChange={onCheckPageChange}
                onPageSizeChange={onCheckPageSizeChange}
                itemLabel="checks"
              />
            </section>
          )}
        </>
      )}

      {brand && (
        <CheckReviewDrawer
          open={reviewingId !== null}
          onClose={() => setReviewingId(null)}
          brandId={brand.id}
          checkId={reviewingId}
          onReviewed={onReviewed}
        />
      )}
    </div>
  );
}
