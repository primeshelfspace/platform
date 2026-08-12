'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { TopProgress } from './top-progress';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ScrollText,
  Search,
  Settings,
  Store,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { logoutAction } from '@/lib/logout-action';
import type { Brand, CurrentUser } from '@/lib/api';
import { AddBrandModal } from './add-brand-modal';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const TOP_NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

const BRAND_NAV: readonly NavItem[] = [
  { href: '/brand-settings', label: 'Brand Settings', icon: Store },
];

const MAIN_NAV: readonly NavItem[] = [
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/invoices', label: 'Invoices', icon: ScrollText },
];

// Integrations and Payment Methods are not separate sidebar destinations —
// both already live as tabs inside Brand Settings (see tabs.tsx's
// linkOutTabs), and duplicating them here read as two places for one
// setting. Settings points at Payment Methods only because there is no
// single settings landing page in this app yet; it is the closest thing to
// one. Worth a real /settings page later.
const SETTINGS_NAV: NavItem = {
  href: '/settings/payment-methods',
  label: 'Settings',
  icon: Settings,
};

/** Closes a panel on an outside click or Escape, and hands focus back to
 * whatever opened it — the one bit of behaviour every dropdown here needs. */
function useDismissablePanel<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return ref;
}

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

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
  const activeBrandId = searchParams.get('brandId') ?? brands[0]?.id ?? '';
  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  const brandMenuRef = useDismissablePanel<HTMLDivElement>(brandMenuOpen, () =>
    setBrandMenuOpen(false),
  );
  const accountMenuRef = useDismissablePanel<HTMLDivElement>(accountMenuOpen, () =>
    setAccountMenuOpen(false),
  );
  const headerMenuRef = useDismissablePanel<HTMLDivElement>(headerMenuOpen, () =>
    setHeaderMenuOpen(false),
  );

  // A route change (including a brand switch, which pushes a new URL) closes
  // every open panel — none of them should survive onto the next page.
  useEffect(() => {
    setMobileOpen(false);
    setBrandMenuOpen(false);
    setAccountMenuOpen(false);
    setHeaderMenuOpen(false);
  }, [pathname, activeBrandId]);

  // Reuses Customers' own search (FR-CUS) rather than inventing a separate
  // global index — this box searches the one thing this app can actually
  // search by name or email today.
  function onHeaderSearchSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = new URLSearchParams();
    if (headerSearch.trim()) query.set('search', headerSearch.trim());
    if (activeBrandId) query.set('brandId', activeBrandId);
    router.push(`/customers?${query.toString()}`);
  }

  function hrefFor(path: string): string {
    return activeBrandId ? `${path}?brandId=${activeBrandId}` : path;
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
  // pick the new brand up.
  function onBrandCreated(brandId: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('brandId', brandId);
    router.push(`${pathname}?${params.toString()}`);
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
            ? 'bg-[#2A2A2A] font-semibold text-white'
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
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-sm font-bold text-[#171717]"
          aria-hidden
        >
          {initialOf(companyName)}
        </span>
        <p className="min-w-0 flex-1 truncate text-base font-bold text-white">{companyName}</p>
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

        {activeBrand && (
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
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
                  style={{ backgroundColor: activeBrand.themeColor }}
                  aria-hidden
                >
                  {initialOf(activeBrand.displayName)}
                </span>
                <span className="flex-1 truncate text-[15px] font-bold text-white">
                  {activeBrand.displayName}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#D4D4D4]" aria-hidden />
              </button>

              {brandMenuOpen && (
                <div
                  role="menu"
                  aria-label="Switch brand"
                  className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#232323] py-1 shadow-lg"
                >
                  {brands.map((brand) => (
                    <button
                      key={brand.id}
                      type="button"
                      role="menuitem"
                      onClick={() => onBrandChange(brand.id)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${
                        brand.id === activeBrand.id ? 'text-white' : 'text-[#D4D4D4]'
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

      <div className="border-t border-white/10 px-3 py-3">
        <NavLink {...SETTINGS_NAV} />
      </div>

      <div className="relative border-t border-white/10 p-3" ref={accountMenuRef}>
        {accountMenuOpen && (
          <div
            role="menu"
            aria-label="Account"
            className="absolute inset-x-3 bottom-full z-10 mb-1 overflow-hidden rounded-lg border border-white/10 bg-[#232323] py-1 shadow-lg"
          >
            <Link
              role="menuitem"
              href="/status"
              className="block px-3 py-2 text-sm text-[#D4D4D4] transition-colors hover:bg-white/10 hover:text-white"
            >
              System status
            </Link>
            {/* A form, not a link: signing out revokes the session server-side,
                and that is a state change no GET should perform (FR-AUTH-010). */}
            <form action={logoutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#D4D4D4] transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        )}

        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onClick={() => setAccountMenuOpen((open) => !open)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/10"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[#171717]"
            aria-hidden
          >
            {initialOf(user.name || user.email)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-white">
              {user.name || user.email}
            </span>
            <span className="block truncate text-xs text-[#8C8C8C]">{user.email}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#8C8C8C]" aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
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
        <header className="hidden shrink-0 items-center gap-4 border-b border-border bg-surface px-6 py-3 lg:flex">
          <form onSubmit={onHeaderSearchSubmit} className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden
            />
            <input
              type="search"
              aria-label="Search customers by name or email"
              value={headerSearch}
              onChange={(event) => setHeaderSearch(event.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink-strong
                         placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-ink-strong focus-visible:ring-offset-1"
            />
          </form>

          {/* ml-auto rather than relying on the search box's own flex-grow to
              push these right: the search box caps out at max-w-sm, so once
              the header is wider than that plus these two controls, the
              leftover space would sit unclaimed after them instead of
              pinning them to the header's trailing edge. */}
          <div className="ml-auto flex shrink-0 items-center gap-4">
            <Link
              href={hrefFor('/settings/payment-methods')}
              aria-label="Settings"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted
                         transition-colors hover:bg-surface-muted hover:text-ink-strong"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </Link>

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

        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>

      <AddBrandModal
        open={addBrandOpen}
        brands={brands}
        onClose={() => setAddBrandOpen(false)}
        onCreated={onBrandCreated}
      />
    </div>
  );
}
