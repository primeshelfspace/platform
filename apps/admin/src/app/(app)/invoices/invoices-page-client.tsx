'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, ChevronDown, Plus, ScrollText, Search } from 'lucide-react';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { Brand, Invoice } from '@/lib/api';
import {
  invoiceListStatus,
  invoiceListStatusDot,
  invoiceListStatusLabel,
  invoiceListStatusTone,
  type InvoiceListStatus,
} from '@/lib/invoice-presentation';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';

/** How long the search box waits after the last keystroke before pushing a
 * new URL — matches CustomersPageClient's own debounce (FR-CUS list). The
 * filtering itself never waits on this; it runs against `searchTerm`
 * directly so the table updates on every keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

const TABS: ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly InvoiceListStatus[] | null;
}> = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'draft', label: 'Drafts', statuses: ['DRAFT'] },
  { key: 'unpaid', label: 'Unpaid', statuses: ['UNPAID'] },
  { key: 'paid', label: 'Paid', statuses: ['PAID'] },
  { key: 'overdue', label: 'Overdue', statuses: ['OVERDUE'] },
];

const RANGE_OPTIONS = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

export function InvoicesPageClient({
  brand,
  invoices,
  tab,
  search,
  range,
  paymentPublicUrl,
  brandsError,
  hasBrands,
  invoicesError,
  justCreated,
}: {
  brand: Brand | null;
  invoices: Invoice[];
  tab: string;
  search: string;
  range: string;
  paymentPublicUrl: string;
  brandsError: string | null;
  hasBrands: boolean;
  invoicesError: string | null;
  justCreated: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchTerm, setSearchTerm] = useState(search);
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rangeMenuRef = useDismissablePanel<HTMLDivElement>(rangeMenuOpen, () =>
    setRangeMenuOpen(false),
  );

  // A brand switch or a searchParams change from elsewhere (browser back,
  // another tab) should still show up in the box, not just this box's own edits.
  useEffect(() => setSearchTerm(search), [search]);

  function pushParams(next: Record<string, string | null>) {
    const query = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') query.delete(key);
      else query.set(key, value);
    }
    router.push(`${pathname}?${query.toString()}`);
  }

  function onSearchChange(value: string) {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => pushParams({ search: value || null }),
      SEARCH_DEBOUNCE_MS,
    );
  }

  function onTabChange(key: string) {
    pushParams({ tab: key === 'all' ? null : key });
  }

  function onRangeChange(key: string) {
    pushParams({ range: key === '90' ? null : key });
    setRangeMenuOpen(false);
  }

  const withStatus = useMemo(
    () => invoices.map((inv) => ({ inv, status: invoiceListStatus(inv) })),
    [invoices],
  );

  const rangeFiltered = useMemo(() => {
    if (range === 'all') return withStatus;
    const cutoff = Date.now() - Number(range) * DAY_MS;
    return withStatus.filter(({ inv }) => new Date(inv.invoiceDate).getTime() >= cutoff);
  }, [withStatus, range]);

  const counts = useMemo(() => {
    let draft = 0;
    let unpaid = 0;
    let paid = 0;
    let overdue = 0;
    for (const { status } of rangeFiltered) {
      if (status === 'DRAFT') draft++;
      else if (status === 'UNPAID') unpaid++;
      else if (status === 'PAID') paid++;
      else if (status === 'OVERDUE') overdue++;
      // CANCELLED counts toward "All" only — it has no tab of its own.
    }
    return { all: rangeFiltered.length, draft, unpaid, paid, overdue } as Record<string, number>;
  }, [rangeFiltered]);

  const visible = useMemo(() => {
    const activeStatuses = TABS.find((t) => t.key === tab)?.statuses ?? null;
    const term = searchTerm.trim().toLowerCase();
    return rangeFiltered.filter(({ inv, status }) => {
      if (activeStatuses && !activeStatuses.includes(status)) return false;
      if (!term) return true;
      const haystack = `${inv.number} ${inv.customer?.displayName ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [rangeFiltered, tab, searchTerm]);

  const currency = toCurrencyCode(brand?.currency);
  const activeRangeLabel = RANGE_OPTIONS.find((r) => r.key === range)?.label ?? 'Last 90 days';

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A]">Invoices</h1>
          <p className="mt-1 text-[15px] text-[#64748B]">
            Full invoice lifecycle for this brand, synchronized with Zoho Books.
          </p>
        </div>
        {brand && (
          <Link
            href={`/invoices/new?brandId=${brand.id}`}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-black px-4 text-sm font-bold
                       text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Invoice
          </Link>
        )}
      </header>

      {brandsError ? (
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
          <p className="font-medium">Could not load brands.</p>
          <p className="mt-1 font-mono text-xs">{brandsError}</p>
        </div>
      ) : !hasBrands ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">No brands exist yet.</p>
          <Link
            href="/brands/new"
            className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
          >
            Create your first brand
          </Link>
        </div>
      ) : (
        <>
          {justCreated && (
            <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
              Invoice created and issued. Its payment link is below.
            </div>
          )}

          <div className="mb-4 flex items-center gap-6 border-b border-[#E5E7EB]">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTabChange(t.key)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm transition-colors ${
                    active
                      ? 'border-[#0F172A] font-bold text-[#0F172A]'
                      : 'border-transparent font-medium text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {t.label}
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs
                                font-bold ${active ? 'bg-[#0F172A] text-white' : 'bg-[#F1F1F2] text-[#64748B]'}`}
                  >
                    {counts[t.key] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search invoices by number or customer"
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search"
                className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white pl-9 pr-3 text-sm text-[#0F172A]
                           shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-[#94A3B8]
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900
                           focus-visible:ring-offset-1"
              />
            </div>

            <div className="relative shrink-0" ref={rangeMenuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={rangeMenuOpen}
                onClick={() => setRangeMenuOpen((open) => !open)}
                className="flex h-10 items-center gap-2 rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm
                           text-[#0F172A] shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
              >
                <Calendar className="h-4 w-4 text-[#64748B]" aria-hidden />
                {activeRangeLabel}
                <ChevronDown className="h-4 w-4 text-[#64748B]" aria-hidden />
              </button>

              {rangeMenuOpen && (
                <div
                  role="menu"
                  aria-label="Date range"
                  className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-[#E5E7EB]
                             bg-white py-1 shadow-lg"
                >
                  {RANGE_OPTIONS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      role="menuitem"
                      onClick={() => onRangeChange(r.key)}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[#F5F5F6] ${
                        r.key === range ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white shadow-sm">
            {invoicesError ? (
              <div className="p-6 text-sm text-danger">
                <p className="font-medium">Could not load invoices.</p>
                <p className="mt-1 font-mono text-xs">{invoicesError}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <ScrollText className="h-8 w-8 text-ink-subtle" aria-hidden />
                <p className="font-medium text-ink-strong">No invoices found</p>
                <p className="text-sm text-ink-muted">
                  {searchTerm || tab !== 'all'
                    ? 'No invoice matches these filters.'
                    : `Create the first invoice for ${brand?.displayName}.`}
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr
                    className="border-b border-[#E5E7EB] bg-[#F5F5F6] text-left text-xs font-semibold uppercase
                                  tracking-wide text-[#8C919B]"
                  >
                    <th className="px-5 py-3">Invoice</th>
                    <th className="px-3 py-3">Customer</th>
                    <th className="px-3 py-3">Brand</th>
                    <th className="px-3 py-3">Issue Date</th>
                    <th className="px-3 py-3">Due Date</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ inv, status }) => (
                    <tr key={inv.id} className="border-b border-[#E5E7EB] last:border-0">
                      <td className="px-5 py-3 font-semibold text-[#0F172A]">{inv.number}</td>
                      <td className="px-3 py-3 text-[#0F172A]">
                        {inv.customer?.displayName ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        {brand && (
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px]
                                         font-bold text-white"
                              style={{ backgroundColor: brand.themeColor }}
                              aria-hidden
                            >
                              {initialOf(brand.displayName)}
                            </span>
                            <span className="text-[#0F172A]">{brand.displayName}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[#64748B]">
                        {formatDateForDisplay(inv.invoiceDate)}
                      </td>
                      <td className="px-3 py-3 text-[#64748B]">
                        {formatDateForDisplay(inv.dueDate)}
                      </td>
                      <td className="px-3 py-3 font-medium text-[#0F172A]">
                        {formatMinorForDisplay(inv.totalMinor, currency)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-sm font-medium ${invoiceListStatusTone(status)}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${invoiceListStatusDot(status)}`}
                            aria-hidden
                          />
                          {invoiceListStatusLabel(status)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href={`${paymentPublicUrl}/i/${inv.publicToken}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center rounded-lg border border-[#0F172A] bg-white px-3
                                     text-xs font-bold text-[#0F172A] transition-colors hover:bg-slate-50"
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
