'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { TopProgress } from './top-progress';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Banknote,
  ChevronDown,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { logoutAction } from '@/lib/logout-action';
import { hasPermission } from '@/lib/permissions';
import type { Brand, CurrentUser } from '@/lib/api';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { PermissionsProvider } from '@/hooks/use-permissions';
import { AddBrandModal } from './add-brand-modal';
import { SugrpayIcon } from './sugrpay-icon';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// Notifications removed from here deliberately: the feed it pointed to was
// never built (apps/admin/src/app/(app)/notifications/page.tsx says so
// explicitly), so the bell just led to an empty placeholder. Re-add once
// there is an actual feed behind it.
const TOP_NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shop-payment-gateways', label: 'Shop Payment Gateways', icon: ShoppingBag },
];

const BRAND_NAV: readonly NavItem[] = [
  { href: '/brand-settings', label: 'Brand Settings', icon: Store },
];

const MAIN_NAV: readonly NavItem[] = [
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/invoices', label: 'Invoices', icon: ScrollText },
  { href: '/payments', label: 'Payments', icon: Banknote },
];

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** The explicit, bookmarkable "All Brands" value for `?brandId=` — chosen
 * over simply omitting the param, which would be ambiguous with "brand not
 * yet chosen" on first load. Only the dashboard understands it; every other
 * page in the app is inherently single-brand. */
const ALL_BRANDS = 'all';

/** Paths that can render for every brand at once. Every other nav
 * destination substitutes a concrete brand when "All Brands" is active,
 * since those pages were never built to receive no brandId at all. */
const ALL_BRANDS_AWARE_PATHS = new Set(['/']);

/**
 * The one place brand selection lives. Every nav link carries the current
 * brandId forward, and switching brands keeps the current page — a merchant
 * comparing invoices across brands should not get bounced to the dashboard
 * every time they change brand.
 */
export function AdminShell({
  brands,
  user,
  companyName,
  children,
}: {
  brands: Brand[];
  user: CurrentUser;
  /** The merchant's own legal name, shown in the sidebar header — distinct
   * from any one brand's name, since a merchant can own several. */
  companyName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawBrandParam = searchParams.get('brandId');
  // 'all' only means something when there is more than one brand to
  // aggregate — a single-brand merchant never sees the option, so a stray
  // ?brandId=all for one falls back to that one brand instead of an
  // unreachable All Brands state.
  const allBrandsSelected = rawBrandParam === ALL_BRANDS && brands.length > 1;
  const activeBrandId = allBrandsSelected ? null : (rawBrandParam ?? brands[0]?.id ?? '');
  const activeBrand = activeBrandId
    ? (brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null)
    : null;
  const firstConcreteBrandId = brands[0]?.id ?? '';

  // Users & Roles lives in the account menu, shown only when the signed-in
  // user holds USERS READ — hiding it for anyone else is UX only, not the
  // actual access control, which the API guard enforces regardless of what
  // this menu renders.
  const canManageUsers = hasPermission(user, 'USERS', 'READ');
  // Creating a brand is BRANDS WRITE — Owner and Merchant Admin only.
  const canAddBrand = hasPermission(user, 'BRANDS', 'WRITE');

  const [mobileOpen, setMobileOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  const brandMenuRef = useDismissablePanel<HTMLDivElement>(brandMenuOpen, () =>
    setBrandMenuOpen(false),
  );
  const headerMenuRef = useDismissablePanel<HTMLDivElement>(headerMenuOpen, () =>
    setHeaderMenuOpen(false),
  );

  // A route change (including a brand switch, which pushes a new URL) closes
  // every open panel — none of them should survive onto the next page.
  useEffect(() => {
    setMobileOpen(false);
    setBrandMenuOpen(false);
    setHeaderMenuOpen(false);
  }, [pathname, activeBrandId]);

  // Reuses Customers' own search (FR-CUS) rather than inventing a separate
  // global index — this box searches the one thing this app can actually
  // search by name or email today.
  function onHeaderSearchSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = new URLSearchParams();
    if (headerSearch.trim()) query.set('search', headerSearch.trim());
    // /customers has no All Brands mode of its own — searching from there
    // always lands on a concrete brand, same as every other single-brand nav
    // destination below.
    const brandForCustomers = activeBrandId ?? firstConcreteBrandId;
    if (brandForCustomers) query.set('brandId', brandForCustomers);
    router.push(`/customers?${query.toString()}`);
  }

  /** Dashboard carries the real selection through, "all" included — every
   * other destination is inherently single-brand and substitutes the first
   * concrete brand rather than breaking on a missing brandId. */
  function hrefFor(path: string): string {
    if (ALL_BRANDS_AWARE_PATHS.has(path)) {
      if (activeBrandId === null) return `${path}?brandId=${ALL_BRANDS}`;
      return activeBrandId ? `${path}?brandId=${activeBrandId}` : path;
    }
    const brand = activeBrandId ?? firstConcreteBrandId;
    return brand ? `${path}?brandId=${brand}` : path;
  }

  function isActive(path: string): boolean {
    return path === '/' ? pathname === '/' : pathname.startsWith(path);
  }

  function onBrandChange(brandId: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('brandId', brandId);
    router.push(`${pathname}?${params.toString()}`);
    setBrandMenuOpen(false);
  }

  // The brands list is a prop from the (app) layout's server component, so a
  // push alone would land on the new brand's id before that list has ever
  // been refetched with it in it — refresh forces the layout to rerun and
  // pick the new brand up. Lands on Brand Settings regardless of which page
  // "Add Brand" was opened from — a brand new brand has nothing configured
  // yet, so that's the next thing worth seeing, not wherever the sidebar
  // happened to be.
  function onBrandCreated(brandId: string): void {
    router.push(`/brand-settings?brandId=${brandId}`);
    router.refresh();
    setAddBrandOpen(false);
  }

  function NavLink({ href, label, icon: Icon }: NavItem) {
    const active = isActive(href);
    return (
      <Link
        href={hrefFor(href)}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors ${
          active
            ? 'bg-[#404040] font-semibold text-white'
            : 'font-normal text-[#D4D4D4] hover:bg-[#232323] hover:text-white'
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        {label}
      </Link>
    );
  }

  const sidebar = (
    <div className="flex h-full w-[280px] flex-col bg-[#171717] text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <SugrpayIcon className="h-8 w-8 shrink-0" />
        {/* Text, not the baked vector wordmark this replaced (which actually
          spelled out a reseller's own company name, "Prime Shelf Space
          Inc." — a leftover that had nothing to do with this product and
          disagreed with the "Sugrpay" <title> every page already carries).
          Real text also means aria-label and the pixels finally agree. */}
        <span
          role="img"
          aria-label="Sugrpay"
          className="flex items-baseline text-xl font-extrabold leading-none tracking-tight"
        >
          <span aria-hidden>SUGR</span>
          <span aria-hidden className="text-[#F97316]">
            PAY
          </span>
        </span>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1 border-b border-white/10 pb-4">
          {TOP_NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {brands.length > 0 && (
          <div className="mt-4 space-y-1 border-b border-white/10 pb-4">
            <p className="px-3 text-xs font-medium uppercase tracking-wide text-[#8C8C8C]">
              Brands
            </p>

            <div className="relative" ref={brandMenuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={brandMenuOpen}
                onClick={() => setBrandMenuOpen((open) => !open)}
                className="flex w-full items-center gap-3 rounded-lg bg-white/10 px-3 py-2 text-left
                           transition-colors hover:bg-white/15"
              >
                {activeBrand ? (
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
                    style={{ backgroundColor: activeBrand.themeColor }}
                    aria-hidden
                  >
                    {initialOf(activeBrand.displayName)}
                  </span>
                ) : (
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white"
                    aria-hidden
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <span className="flex-1 truncate text-[15px] font-bold text-white">
                  {activeBrand ? activeBrand.displayName : 'All Brands'}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#D4D4D4]" aria-hidden />
              </button>

              {brandMenuOpen && (
                <div
                  role="menu"
                  aria-label="Switch brand"
                  className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#232323] py-1 shadow-lg"
                >
                  {brands.length > 1 && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onBrandChange(ALL_BRANDS)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${
                          activeBrandId === null ? 'text-white' : 'text-[#D4D4D4]'
                        }`}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 text-white"
                          aria-hidden
                        >
                          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="truncate font-medium">All Brands</span>
                      </button>
                      <div className="my-1 border-t border-white/10" aria-hidden />
                    </>
                  )}

                  {brands.map((brand) => (
                    <button
                      key={brand.id}
                      type="button"
                      role="menuitem"
                      onClick={() => onBrandChange(brand.id)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${
                        brand.id === activeBrandId ? 'text-white' : 'text-[#D4D4D4]'
                      }`}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                        style={{ backgroundColor: brand.themeColor }}
                        aria-hidden
                      >
                        {initialOf(brand.displayName)}
                      </span>
                      <span className="truncate">{brand.displayName}</span>
                    </button>
                  ))}

                  {canAddBrand && (
                    <>
                      <div className="my-1 border-t border-white/10" aria-hidden />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setBrandMenuOpen(false);
                          setAddBrandOpen(true);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#D4D4D4]
                               transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-[#8C8C8C]"
                          aria-hidden
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="truncate font-medium">Add New Brand</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-1">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
          {BRAND_NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>
      </nav>
    </div>
  );

  return (
    <PermissionsProvider permissions={user.permissions}>
      <div className="min-h-screen lg:flex lg:h-screen">
        <TopProgress />
        {/* Mobile top bar: the sidebar is off-canvas below lg (1024px) — no
          collapse breakpoint was established elsewhere in this app, so this
          follows Tailwind's own default lg cut-off. */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="rounded-md p-2 text-ink-strong hover:bg-surface-muted"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <p className="truncate text-sm font-semibold text-ink-strong">{companyName}</p>
          <span className="w-9" aria-hidden />
        </div>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 ease-out
                    lg:static lg:z-auto lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : ''}`}
        >
          {sidebar}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Desktop-only header: the mobile top bar above already covers
            navigation below lg, and there is nowhere on a phone screen to
            put a search box that isn't in the way. */}
          <header className="hidden shrink-0 items-center gap-4 bg-surface px-6 py-3 lg:flex">
            <form onSubmit={onHeaderSearchSubmit} className="relative max-w-sm flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[#737373]"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search customers by name or email"
                value={headerSearch}
                onChange={(event) => setHeaderSearch(event.target.value)}
                placeholder="Search"
                className="h-8 w-full appearance-none rounded-lg bg-[#E7EDF5] pl-9 pr-3 text-sm text-[#0F172A]
                         placeholder:text-[#737373] focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-ink-strong focus-visible:ring-offset-1"
              />
            </form>

            {/* ml-auto rather than relying on the search box's own flex-grow to
              push these right: the search box caps out at max-w-sm, so once
              the header is wider than that plus the account menu, the
              leftover space would sit unclaimed after them instead of
              pinning them to the header's trailing edge. */}
            <div className="ml-auto flex shrink-0 items-center gap-4">
              <div className="relative shrink-0" ref={headerMenuRef}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={headerMenuOpen}
                  onClick={() => setHeaderMenuOpen((open) => !open)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7C3AED] text-sm font-bold
                           text-white transition-opacity hover:opacity-90"
                >
                  {initialOf(user.name || user.email)}
                </button>

                {headerMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Account"
                    className="absolute right-0 z-10 mt-2 w-48 overflow-hidden rounded-lg border border-border
                             bg-surface py-1 shadow-lg"
                  >
                    <div className="border-b border-border px-3 py-2">
                      <p className="truncate text-sm font-semibold text-ink-strong">
                        {user.name || user.email}
                      </p>
                      <p className="truncate text-xs text-ink-subtle">{user.email}</p>
                    </div>
                    {canManageUsers && (
                      <Link
                        role="menuitem"
                        href={hrefFor('/users')}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted transition-colors
                                 hover:bg-surface-muted hover:text-ink-strong"
                      >
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        Users &amp; Roles
                      </Link>
                    )}
                    <Link
                      role="menuitem"
                      href="/status"
                      className="block px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted
                               hover:text-ink-strong"
                    >
                      System status
                    </Link>
                    <form action={logoutAction}>
                      <button
                        type="submit"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-muted
                                 transition-colors hover:bg-surface-muted hover:text-ink-strong"
                      >
                        <LogOut className="h-4 w-4" aria-hidden />
                        Sign out
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="no-scrollbar min-w-0 flex-1 overflow-y-auto">
            {/* Keyed by pathname so each real route change remounts this div and
              re-triggers the fade — the CSS animation only plays on mount, so
              without the key it would run once and never again. Deliberately
              not keyed on the full URL: switching a query-param filter (a
              brand, a tab, a search term) is an in-page state change, not a
              page transition, and animating every one of those would be the
              "excessive animation" this is supposed to avoid. */}
            <div key={pathname} className="page-transition">
              {children}
            </div>
          </div>
        </div>

        {canAddBrand && (
          <AddBrandModal
            open={addBrandOpen}
            brands={brands}
            onClose={() => setAddBrandOpen(false)}
            onCreated={onBrandCreated}
          />
        )}
      </div>
    </PermissionsProvider>
  );
}
