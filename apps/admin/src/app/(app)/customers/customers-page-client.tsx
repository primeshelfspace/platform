'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Users } from 'lucide-react';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import { Toggle } from '@/components/ui/toggle';
import type { Brand, Customer, CustomerListRow, CustomerWithContacts, Invoice } from '@/lib/api';
import { AddCustomerModal } from './add-customer-modal';
import { CustomerDetailDrawer } from './customer-detail-drawer';
import { getCustomerDetailAction } from './actions';

/** How long the search box waits after the last keystroke before pushing a
 * new URL — long enough that a fast typist doesn't fire a request per
 * keystroke, short enough that it still reads as "real-time" (FR-CUS list). */
const SEARCH_DEBOUNCE_MS = 300;

export function CustomersPageClient({
  brand,
  customers,
  total,
  search,
  outstandingOnly,
  brandsError,
  hasBrands,
  customersError,
}: {
  brand: Brand | null;
  customers: CustomerListRow[];
  total: number;
  search: string;
  outstandingOnly: boolean;
  brandsError: string | null;
  hasBrands: boolean;
  customersError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchTerm, setSearchTerm] = useState(search);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [justAdded, setJustAdded] = useState<Customer | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The detail slide-over. `detailRow` (the list row already on screen) drives
  // the header and Outstanding Balance instantly; `detail` is what the server
  // action fills in once it resolves, so the panel opens right away with what
  // it already knows rather than waiting on a round-trip first.
  const [detailRow, setDetailRow] = useState<CustomerListRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{
    customer: CustomerWithContacts;
    invoices: Invoice[];
  } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  function openCustomerDetail(row: CustomerListRow) {
    setDetailRow(row);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    getCustomerDetailAction(row.brandId, row.id)
      .then((result) => {
        if (result.customer) {
          setDetail({ customer: result.customer, invoices: result.invoices ?? [] });
        } else {
          setDetailError(result.error ?? 'Could not load this customer.');
        }
      })
      .catch((error: unknown) => {
        setDetailError(error instanceof Error ? error.message : 'Could not load this customer.');
      })
      .finally(() => setDetailLoading(false));
  }

  function closeCustomerDetail() {
    setDetailRow(null);
    setDetail(null);
    setDetailError(null);
  }

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

  function onOutstandingChange(checked: boolean) {
    pushParams({ outstanding: checked ? '1' : null });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(customers.map((c) => c.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onCustomerCreated(customer: Customer) {
    setAddOpen(false);
    setJustAdded(customer);
    router.refresh();
  }

  const allSelected = customers.length > 0 && selected.size === customers.length;
  const currency = toCurrencyCode(brand?.currency);

  return (
    <div>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A]">Customers</h1>
          <p className="mt-1 text-[15px] text-[#64748B]">
            View, add, and manage customers for invoicing and payments.
          </p>
        </div>
        {brand && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-black px-4 text-sm font-bold
                       text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add Customer
          </button>
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
          {justAdded && (
            <div className="mb-4 rounded-md bg-success-surface p-3 text-sm text-success">
              {justAdded.displayName} was added.
            </div>
          )}

          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="relative max-w-xs flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search customers by name or email"
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search"
                className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white pl-9 pr-3 text-sm text-[#0F172A]
                           shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-[#94A3B8]
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900
                           focus-visible:ring-offset-1"
              />
            </div>
            {/* Toggle's 'row' layout gives label-left/switch-right (what the
                design calls for) but assumes a list context and adds a
                bottom rule between rows — stripped here since this is the
                only row in this context, not a list of settings. The pill
                card look (border/shadow) is applied on this wrapper rather
                than the shared Toggle component, so other call sites (e.g.
                payment-methods) keep their own plain-row appearance. */}
            <div
              className="flex items-center rounded-lg border border-[#D4D4D4] bg-white px-4 py-2
                         shadow-[0_1px_1px_rgba(0,0,0,0.05)] [&>label]:border-0 [&>label]:py-0"
            >
              <Toggle
                layout="row"
                checked={outstandingOnly}
                onChange={onOutstandingChange}
                label="Outstanding only"
              />
            </div>
          </div>

          <section className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white shadow-sm">
            {customersError ? (
              <div className="p-6 text-sm text-danger">
                <p className="font-medium">Could not load customers.</p>
                <p className="mt-1 font-mono text-xs">{customersError}</p>
              </div>
            ) : customers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <Users className="h-8 w-8 text-ink-subtle" aria-hidden />
                <p className="font-medium text-ink-strong">No customers yet</p>
                <p className="text-sm text-ink-muted">
                  {search
                    ? 'No customer matches that search.'
                    : `Add the first customer for ${brand?.displayName}.`}
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr
                    className="border-b border-[#E5E7EB] bg-[#F5F5F6] text-left text-xs font-semibold uppercase
                                  tracking-wide text-[#8C919B]"
                  >
                    <th className="w-10 px-5 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all customers"
                        checked={allSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                        className="h-4 w-4 accent-black"
                      />
                    </th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Outstanding</th>
                    <th className="px-3 py-2">Invoices</th>
                    <th className="px-3 py-2">Payments</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b border-[#E5E7EB] last:border-0">
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.displayName}`}
                          checked={selected.has(c.id)}
                          onChange={(event) => toggleOne(c.id, event.target.checked)}
                          className="h-4 w-4 accent-black"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-ink-strong">{c.displayName}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.email ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.phone ?? '—'}</td>
                      <td className="px-3 py-2">
                        {c.outstandingMinor > 0 ? (
                          <span className="font-medium" style={{ color: '#D97706' }}>
                            {formatMinorForDisplay(c.outstandingMinor, currency)}
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{c.invoiceCount}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.paymentCount}</td>
                      <td className="px-5 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openCustomerDetail(c)}
                          className="inline-flex h-8 items-center rounded-md border border-[#0F172A] bg-white px-3
                                     text-xs font-bold text-[#0F172A] transition-colors hover:bg-slate-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {total > customers.length && (
            <p className="mt-3 text-xs text-ink-subtle">
              Showing {customers.length} of {total}.
            </p>
          )}
        </>
      )}

      {brand && (
        <AddCustomerModal
          open={addOpen}
          brandId={brand.id}
          onClose={() => setAddOpen(false)}
          onCreated={onCustomerCreated}
        />
      )}

      <CustomerDetailDrawer
        open={detailRow !== null}
        onClose={closeCustomerDetail}
        brandName={brand?.displayName}
        loading={detailLoading}
        error={detailError}
        customer={detail?.customer ?? null}
        invoices={detail?.invoices ?? []}
        outstandingMinor={detailRow?.outstandingMinor ?? 0}
        currency={currency}
      />
    </div>
  );
}
