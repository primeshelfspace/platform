'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, ChevronDown, Info, Plus, ScrollText, Search, Send, X } from 'lucide-react';
import { toast } from '@fenwick/ui/toast';
import { formatDateForDisplay } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { Brand, Invoice, InvoiceActivityEntry, InvoiceDetail } from '@/lib/api';
import {
  invoiceListStatus,
  invoiceListStatusDot,
  invoiceListStatusLabel,
  invoiceListStatusTone,
  type InvoiceListStatus,
} from '@/lib/invoice-presentation';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { bulkSendInvoicesAction, getInvoiceDetailAction } from './actions';
import { BulkSendConfirmModal, BulkSendProgressModal } from './bulk-send-confirm-modal';
import { InvoiceDetailDrawer } from './invoice-detail-drawer';

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
  { key: 'partial', label: 'Partial', statuses: ['PARTIAL'] },
  { key: 'overdue', label: 'Overdue', statuses: ['OVERDUE'] },
];

/** A row can be bulk-sent (or resent) unless it's already settled — same
 * exclusion InvoicesService.bulkSend applies server-side; disabling its
 * checkbox here just saves a round trip to learn that. */
function isBulkSendable(status: InvoiceListStatus): boolean {
  return status !== 'PAID' && status !== 'CANCELLED';
}

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

  // The detail slide-over — same pattern as CustomersPageClient's own
  // openCustomerDetail/closeCustomerDetail: `detailOpen` drives visibility
  // instantly, `detail` is what the server action fills in once it resolves.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceDetail | null>(null);
  const [detailActivity, setDetailActivity] = useState<InvoiceActivityEntry[]>([]);
  const [detailPaymentTerms, setDetailPaymentTerms] = useState<string | null | undefined>(
    undefined,
  );

  function openInvoiceDetail(invoiceId: string) {
    if (!brand) return;
    setDetailOpen(true);
    setDetailInvoice(null);
    setDetailActivity([]);
    setDetailPaymentTerms(undefined);
    setDetailError(null);
    setDetailLoading(true);
    getInvoiceDetailAction(brand.id, invoiceId)
      .then((result) => {
        if (result.invoice) {
          setDetailInvoice(result.invoice);
          setDetailActivity(result.activity ?? []);
          setDetailPaymentTerms(result.paymentTermsLabel);
        } else {
          setDetailError(result.error ?? 'Could not load this invoice.');
        }
      })
      .catch((error: unknown) => {
        setDetailError(error instanceof Error ? error.message : 'Could not load this invoice.');
      })
      .finally(() => setDetailLoading(false));
  }

  function closeInvoiceDetail() {
    setDetailOpen(false);
    setDetailInvoice(null);
    setDetailActivity([]);
    setDetailError(null);
  }

  // A brand switch or a searchParams change from elsewhere (browser back,
  // another tab) should still show up in the box, not just this box's own edits.
  useEffect(() => setSearchTerm(search), [search]);

  // createInvoiceAction redirects here on success (a server action redirect
  // crosses the page boundary before any client code can react), so the
  // confirmation has to be carried through the URL rather than fired where
  // the action itself resolves.
  useEffect(() => {
    if (justCreated) {
      toast.success('Invoice created and issued.', { description: 'Its payment link is below.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCreated]);

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
    let partial = 0;
    let overdue = 0;
    for (const { status } of rangeFiltered) {
      if (status === 'DRAFT') draft++;
      else if (status === 'UNPAID') unpaid++;
      else if (status === 'PAID') paid++;
      else if (status === 'PARTIAL') partial++;
      else if (status === 'OVERDUE') overdue++;
      // CANCELLED counts toward "All" only — it has no tab of its own.
    }
    return {
      all: rangeFiltered.length,
      draft,
      unpaid,
      paid,
      partial,
      overdue,
    } as Record<string, number>;
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

  // "Bulk Send Invoices" row selection — sendable rows only (see
  // isBulkSendable); pruned to whatever the current tab/range still covers,
  // so a row that drops out under a filter change can't stay silently
  // selected and surprise someone with an extra send later. The checkbox
  // column and its floating action bar only exist in `bulkMode`, entered
  // from the toolbar button and left either by its own cancel (X) or once a
  // send completes.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [selectAllMenuOpen, setSelectAllMenuOpen] = useState(false);

  const selectAllMenuRef = useDismissablePanel<HTMLDivElement>(selectAllMenuOpen, () =>
    setSelectAllMenuOpen(false),
  );

  const selectableVisible = useMemo(
    () => visible.filter(({ status }) => isBulkSendable(status)),
    [visible],
  );

  // The broader scope "Select all invoices" reaches — this tab's sendable
  // rows regardless of the search box, unlike selectableVisible above (which
  // "Select page" uses, and which the search term does narrow). Pruning
  // against this rather than selectableVisible means clearing/editing the
  // search term never silently drops a "select all" selection that a search
  // filter was merely hiding, not invalidating.
  const selectableAllInTab = useMemo(() => {
    const activeStatuses = TABS.find((t) => t.key === tab)?.statuses ?? null;
    return rangeFiltered.filter(
      ({ status }) =>
        (!activeStatuses || activeStatuses.includes(status)) && isBulkSendable(status),
    );
  }, [rangeFiltered, tab]);

  useEffect(() => {
    const selectableIds = new Set(selectableAllInTab.map(({ inv }) => inv.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => selectableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableAllInTab]);

  // Reflects what's actually rendered under the header checkbox right now
  // (selectableVisible), not the broader "select all invoices" scope — a
  // search-narrowed view showing every one of its own rows selected should
  // read as fully checked even if a wider, hidden selection exists alongside it.
  const allSelected =
    selectableVisible.length > 0 && selectableVisible.every(({ inv }) => selectedIds.has(inv.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  // Derived from the actual selection, not from which control was clicked —
  // ticking every box by hand, using the header checkbox on a tab small
  // enough that "page" and "all" coincide, or using "Select all invoices"
  // from the menu all land here the same way. The banner is about what's
  // true right now, not about how it got that way.
  const allInTabSelected =
    selectableAllInTab.length > 0 && selectedIds.size === selectableAllInTab.length;

  // Distinct customers among the current selection — a bulk send can hit the
  // same customer more than once (several invoices, one inbox), so this is
  // never just selectedIds.size.
  const selectedRecipientCount = useMemo(() => {
    const customerIds = new Set(
      selectableAllInTab
        .filter(({ inv }) => selectedIds.has(inv.id))
        .map(({ inv }) => inv.customerId),
    );
    return customerIds.size;
  }, [selectableAllInTab, selectedIds]);

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableVisible.map(({ inv }) => inv.id)));
  }

  function selectPage() {
    setSelectedIds(new Set(selectableVisible.map(({ inv }) => inv.id)));
    setSelectAllMenuOpen(false);
  }

  function selectAllInvoices() {
    setSelectedIds(new Set(selectableAllInTab.map(({ inv }) => inv.id)));
    setSelectAllMenuOpen(false);
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function exitBulkMode() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkSend() {
    if (!brand || selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);
    setBulkSending(true);
    setSendProgress({ done: 0, total: ids.length });

    // One request per invoice rather than a single batch call, so the
    // progress dialog can report "N of M sent so far" against something
    // real rather than an animation timed to guess how long the batch
    // takes. The server already sends sequentially either way (see
    // InvoicesService.bulkSend); this just moves the loop up a level so
    // there's a checkpoint to report between invoices.
    const sent: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const id of ids) {
      const result = await bulkSendInvoicesAction(brand.id, [id]);
      if (result.ok) {
        sent.push(...result.data.sent);
        skipped.push(...result.data.skipped);
        failed.push(...result.data.failed);
      } else {
        failed.push({ id, reason: result.error });
      }
      setSendProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setBulkSending(false);
    setSendProgress(null);
    setConfirmSendOpen(false);

    const notSent = skipped.length + failed.length;
    if (sent.length > 0 && notSent === 0) {
      toast.success('All invoices sent', { description: `${sent.length} sent` });
    } else if (sent.length > 0) {
      toast.warning('Bulk send complete', {
        description: (
          <>
            <span className="font-medium text-success">{sent.length} sent</span>
            {' · '}
            <span className="font-medium text-danger">{notSent} failed</span>
          </>
        ),
      });
    } else {
      toast.error('No invoices were sent.', {
        description: failed[0]?.reason ?? skipped[0]?.reason,
      });
    }
    exitBulkMode();
  }

  return (
    <div>
      <header className="mb-4 flex items-start justify-between gap-4">
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
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
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
          <div className="mb-3 flex items-center gap-6 border-b border-[#E5E7EB]">
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

          <div className="mb-3 flex items-center gap-3">
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

            {brand && !bulkMode && (
              <button
                type="button"
                onClick={() => setBulkMode(true)}
                className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border
                           border-[#D4D4D4] bg-white px-4 text-sm font-bold text-[#0F172A]
                           shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors hover:bg-surface-muted"
              >
                <Send className="h-4 w-4" aria-hidden />
                Bulk Send Invoices
              </button>
            )}
          </div>

          {allInTabSelected && (
            <div
              className="mb-3 flex h-[42px] items-center justify-between rounded-[10px] border
                         border-[#BFDBFE] bg-[#EFF6FF] py-1.5 pl-4 pr-2.5 text-sm text-[#1D4ED8]"
            >
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0" aria-hidden />
                All <strong>{selectableAllInTab.length}</strong> invoices are selected.
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex h-7 w-[113px] shrink-0 items-center justify-center gap-1.5
                           rounded-md border border-[#D4D4D4] bg-white text-xs font-bold text-[#0F172A]
                           transition-colors hover:bg-surface-muted"
              >
                Clear Selection
              </button>
            </div>
          )}

          <section className="overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
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
                    {bulkMode && (
                      <th className="w-16 px-5 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label="Select all sendable invoices"
                            checked={allSelected}
                            // `indeterminate` is a DOM-only property with no JSX
                            // prop — it has to be set imperatively on the node,
                            // which a callback ref (re-run every render) does.
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={toggleSelectAll}
                            disabled={selectableVisible.length === 0}
                            className="h-4 w-4 rounded border-[#D4D4D4] accent-black"
                          />
                          <div className="relative" ref={selectAllMenuRef}>
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={selectAllMenuOpen}
                              aria-label="Selection options"
                              onClick={() => setSelectAllMenuOpen((open) => !open)}
                              disabled={selectableAllInTab.length === 0}
                              className="flex h-5 w-5 items-center justify-center rounded text-[#8C919B]
                                         transition-colors hover:bg-[#E5E7EB] hover:text-[#0F172A]
                                         disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                            </button>

                            {selectAllMenuOpen && (
                              <div
                                role="menu"
                                aria-label="Selection options"
                                className="absolute left-0 z-20 mt-1 w-40 overflow-hidden rounded-2xl
                                           border border-[#E5E5E5] bg-white py-1 normal-case
                                           shadow-[0px_4px_6px_-2px_rgba(0,0,0,0.03),0px_12px_16px_-4px_rgba(0,0,0,0.08)]"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={selectPage}
                                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-[#F5F5F6]"
                                >
                                  <span className="block text-sm font-semibold text-[#0F172A]">
                                    Select page
                                  </span>
                                  <span className="block text-xs text-[#8C919B]">
                                    {selectableVisible.length} invoice
                                    {selectableVisible.length === 1 ? '' : 's'}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={selectAllInvoices}
                                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-[#F5F5F6]"
                                >
                                  <span className="block text-sm font-semibold text-[#0F172A]">
                                    Select all invoices
                                  </span>
                                  <span className="block text-xs text-[#8C919B]">
                                    {selectableAllInTab.length} total invoice
                                    {selectableAllInTab.length === 1 ? '' : 's'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </th>
                    )}
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2">Invoice Date</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Balance Due</th>
                    <th className="px-3 py-2">Status</th>
                    {!bulkMode && <th className="px-5 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ inv, status }) => (
                    <tr key={inv.id} className="border-b border-[#E5E7EB] last:border-0">
                      {bulkMode && (
                        <td className="px-5 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select invoice ${inv.number}`}
                            checked={selectedIds.has(inv.id)}
                            onChange={() => toggleRow(inv.id)}
                            disabled={!isBulkSendable(status)}
                            className="h-4 w-4 rounded border-[#D4D4D4] accent-black"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 font-semibold text-[#0F172A]">{inv.number}</td>
                      <td className="px-3 py-2 text-[#0F172A]">
                        {inv.customer?.displayName ?? '—'}
                      </td>
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 text-[#64748B]">
                        {formatDateForDisplay(inv.invoiceDate)}
                      </td>
                      <td className="px-3 py-2 text-[#64748B]">
                        {formatDateForDisplay(inv.dueDate)}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0F172A]">
                        {formatMinorForDisplay(inv.totalMinor, currency)}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0F172A]">
                        {formatMinorForDisplay(inv.balanceMinor, currency)}
                      </td>
                      <td className="px-3 py-2">
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
                      {!bulkMode && (
                        <td className="px-5 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openInvoiceDetail(inv.id)}
                            className="inline-flex h-8 items-center rounded-md border border-[#0F172A] bg-white px-3
                                       text-xs font-bold text-[#0F172A] transition-colors hover:bg-slate-50"
                          >
                            View
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {bulkMode &&
        createPortal(
          // Portalled to <body>, not rendered in place — the (app) layout's
          // `.page-transition` wrapper (admin-shell.tsx) keeps a `transform`
          // applied after its enter animation finishes, which makes it the
          // containing block for any `position: fixed` descendant instead of
          // the viewport (same fix as Modal and the detail drawers; see
          // ui/modal.tsx's comment). Without this the bar was fixed to that
          // wrapper's own box, not the screen — it could show up anywhere
          // from the middle of the page to off the top, not flush at bottom.
          <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
            <div
              role="toolbar"
              aria-label="Bulk send selection"
              className="flex items-center gap-3 rounded-2xl bg-[#171717] py-3 pl-4 pr-4 text-white
                         shadow-[0px_12px_24px_-12px_rgba(0,0,0,0.24)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
                {selectedIds.size}
              </span>
              <span className="text-sm font-medium">
                {selectedIds.size} invoice{selectedIds.size === 1 ? '' : 's'} selected
              </span>
              <span className="h-6 w-px bg-white/20" aria-hidden />
              <button
                type="button"
                onClick={() => setConfirmSendOpen(true)}
                disabled={selectedIds.size === 0 || bulkSending}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold
                           text-[#0F172A] transition-opacity hover:opacity-90 disabled:cursor-not-allowed
                           disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden />
                {bulkSending ? 'Sending…' : 'Bulk Send'}
              </button>
              <button
                type="button"
                onClick={exitBulkMode}
                disabled={bulkSending}
                aria-label="Cancel bulk send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70
                           transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>,
          document.body,
        )}

      {brand && (
        <>
          <BulkSendConfirmModal
            open={confirmSendOpen && !bulkSending}
            onClose={() => setConfirmSendOpen(false)}
            brand={brand}
            invoiceCount={selectedIds.size}
            recipientCount={selectedRecipientCount}
            sending={bulkSending}
            onConfirm={() => void handleBulkSend()}
          />
          <BulkSendProgressModal
            open={bulkSending}
            done={sendProgress?.done ?? 0}
            total={sendProgress?.total ?? selectedIds.size}
          />
        </>
      )}

      <InvoiceDetailDrawer
        open={detailOpen}
        onClose={closeInvoiceDetail}
        brand={brand}
        loading={detailLoading}
        error={detailError}
        invoice={detailInvoice}
        activity={detailActivity}
        paymentTermsLabel={detailPaymentTerms}
        onChanged={() => detailInvoice && openInvoiceDetail(detailInvoice.id)}
      />
    </div>
  );
}
