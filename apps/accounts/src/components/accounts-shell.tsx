import Link from 'next/link';
import { Building2, CreditCard, LayoutGrid, LogOut, MapPin, Users } from 'lucide-react';
import type { Action, Resource } from '@platform/platform-contracts';
import type { CurrentUser } from '@/lib/api';
import { logoutAction } from '@/lib/logout-action';
import { can } from '@/lib/permissions';
import { LogoMark } from './logo-mark';
import { NavLink } from './nav-link';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** Hidden unless the user holds this permission (the API enforces it anyway). */
  readonly needs?: readonly [Resource, Action];
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'Products', icon: LayoutGrid },
  { href: '/team', label: 'Team', icon: Users, needs: ['USERS', 'READ'] },
  { href: '/brands', label: 'Brands', icon: Building2, needs: ['BRANDS', 'READ'] },
  { href: '/locations', label: 'Locations', icon: MapPin, needs: ['LOCATIONS', 'READ'] },
  { href: '/billing', label: 'Billing', icon: CreditCard, needs: ['PLAN_AND_BILLING', 'READ'] },
];

export function AccountsShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) {
  const items = NAV.filter((item) => !item.needs || can(user, item.needs[0], item.needs[1]));

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <LogoMark size={32} className="shrink-0" />
          <span className="text-lg font-extrabold tracking-tight text-[#0F172A]">Accounts</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <UserFooter user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <span className="font-extrabold text-[#0F172A]">Accounts</span>
          <nav className="flex gap-3 overflow-x-auto text-sm">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap text-slate-600">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

function UserFooter({ user }: { user: CurrentUser }) {
  return (
    <div className="border-t border-slate-200 px-4 py-4">
      <p className="truncate text-sm font-semibold text-[#0F172A]">{user.name}</p>
      <p className="truncate text-xs text-slate-500">{user.email}</p>
      <form action={logoutAction} className="mt-3">
        <button
          type="submit"
          className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-[#0F172A]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </form>
    </div>
  );
}
