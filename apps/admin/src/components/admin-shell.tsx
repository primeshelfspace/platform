'use client';

import { type ReactNode, useEffect, useState } from 'react';
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
  ShoppingBag,
  Store,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { logoutAction } from '@/lib/logout-action';
import type { Brand, CurrentUser } from '@/lib/api';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { AddBrandModal } from './add-brand-modal';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const TOP_NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shop-payment-gateways', label: 'Shop Payment Gateways', icon: ShoppingBag },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

const BRAND_NAV: readonly NavItem[] = [
  { href: '/brand-settings', label: 'Brand Settings', icon: Store },
];

const MAIN_NAV: readonly NavItem[] = [
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/invoices', label: 'Invoices', icon: ScrollText },
];

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
        <svg
          className="h-8 w-8 shrink-0"
          viewBox="0 0 20 22"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M15.1057 21.9622L6.62448 22L6.61331 17.38L9.07714 17.3774L9.12526 19.5276L14.8685 19.5181C15.9942 19.5164 16.8442 18.5221 16.8192 17.4763C16.7935 16.4252 15.9332 15.4997 14.7877 15.4937L4.13229 15.4447C1.76214 15.4335 0.0296383 13.2481 0.000419593 11.0705C-0.0313773 8.7029 1.74753 6.77102 4.13659 6.52009L6.59956 6.50204L6.62534 -0.00170898L15.0317 0.0266504C17.4586 0.0352441 19.2582 2.14759 19.296 4.41118C19.3355 6.77274 17.4896 8.84727 15.0386 8.95899C13.6404 9.02259 12.3479 8.98391 10.9214 8.97618L10.9188 6.52352L14.9192 6.49602C16.0123 6.48829 16.8175 5.47595 16.8227 4.51603C16.8278 3.42634 15.941 2.48446 14.8006 2.4836L9.1012 2.47931L9.09605 13.0161L14.92 13.0445C17.3237 13.0565 19.2083 15.0442 19.2917 17.3448C19.3759 19.6522 17.6219 21.9476 15.1048 21.9588L15.1057 21.9622ZM6.61503 12.9929L6.60472 9.01141L4.6187 8.98392C3.46456 8.96759 2.50808 9.82696 2.4737 10.9467C2.4419 11.9814 3.26776 12.9714 4.38667 13.017C5.14378 13.0479 5.8562 13.0333 6.61503 12.9929Z"
            fill="white"
          />
        </svg>
        <svg
          className="h-4 w-auto min-w-0 shrink"
          viewBox="0 0 171 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={companyName}
        >
          <path
            d="M2.21729e-05 12.1989V0.562489H4.36366C5.2576 0.562489 6.0076 0.729155 6.61366 1.06249C7.22351 1.39582 7.68373 1.85416 7.99434 2.43749C8.30873 3.01703 8.46593 3.67612 8.46593 4.41476C8.46593 5.16097 8.30873 5.82385 7.99434 6.4034C7.67995 6.98294 7.21593 7.43938 6.60229 7.77272C5.98866 8.10226 5.23298 8.26703 4.33525 8.26703H1.4432V6.53408H4.05116C4.57389 6.53408 5.00192 6.44317 5.33525 6.26135C5.66858 6.07953 5.9148 5.82953 6.07389 5.51135C6.23676 5.19317 6.3182 4.82764 6.3182 4.41476C6.3182 4.00188 6.23676 3.63825 6.07389 3.32385C5.9148 3.00946 5.66669 2.76514 5.32957 2.5909C4.99623 2.41287 4.56631 2.32385 4.03979 2.32385H2.10798V12.1989H2.21729e-05ZM10.206 12.1989V3.47158H12.2003V4.92613H12.2912C12.4503 4.42234 12.723 4.03408 13.1094 3.76135C13.4995 3.48484 13.9446 3.34658 14.4446 3.34658C14.5583 3.34658 14.6852 3.35226 14.8253 3.36362C14.9692 3.3712 15.0886 3.38446 15.1833 3.4034V5.29544C15.0961 5.26514 14.9579 5.23862 14.7685 5.2159C14.5829 5.18938 14.403 5.17613 14.2287 5.17613C13.8537 5.17613 13.5166 5.25756 13.2174 5.42044C12.9219 5.57953 12.6889 5.80113 12.5185 6.08522C12.348 6.36931 12.2628 6.69696 12.2628 7.06817V12.1989H10.206ZM16.5497 12.1989V3.47158H18.6066V12.1989H16.5497ZM17.5838 2.23294C17.2581 2.23294 16.9778 2.12499 16.7429 1.90908C16.5081 1.68938 16.3906 1.42612 16.3906 1.11931C16.3906 0.808701 16.5081 0.545443 16.7429 0.329534C16.9778 0.109837 17.2581 -1.14441e-05 17.5838 -1.14441e-05C17.9134 -1.14441e-05 18.1937 0.109837 18.4247 0.329534C18.6596 0.545443 18.777 0.808701 18.777 1.11931C18.777 1.42612 18.6596 1.68938 18.4247 1.90908C18.1937 2.12499 17.9134 2.23294 17.5838 2.23294ZM20.7216 12.1989V3.47158H22.6875V4.95453H22.7898C22.9716 4.45453 23.2727 4.06438 23.6932 3.78408C24.1137 3.49999 24.6156 3.35794 25.1989 3.35794C25.7898 3.35794 26.2879 3.50188 26.6932 3.78976C27.1023 4.07385 27.3902 4.46211 27.5568 4.95453H27.6477C27.8409 4.46969 28.1667 4.08332 28.625 3.79544C29.0871 3.50378 29.6345 3.35794 30.2671 3.35794C31.0701 3.35794 31.7254 3.61173 32.233 4.11931C32.7406 4.62688 32.9943 5.36741 32.9943 6.3409V12.1989H30.9318V6.65908C30.9318 6.11741 30.7879 5.72158 30.5 5.47158C30.2121 5.21779 29.8599 5.0909 29.4432 5.0909C28.947 5.0909 28.5587 5.2462 28.2784 5.55681C28.0019 5.86363 27.8637 6.26325 27.8637 6.75567V12.1989H25.8466V6.57385C25.8466 6.12309 25.7102 5.76325 25.4375 5.49431C25.1686 5.22537 24.8163 5.0909 24.3807 5.0909C24.0852 5.0909 23.8163 5.16666 23.5739 5.31817C23.3315 5.4659 23.1383 5.67613 22.9943 5.94885C22.8504 6.21779 22.7784 6.53219 22.7784 6.89203V12.1989H20.7216ZM38.9446 12.3693C38.0696 12.3693 37.3139 12.1875 36.6776 11.8239C36.045 11.4564 35.5583 10.9375 35.2174 10.267C34.8764 9.59279 34.706 8.79923 34.706 7.88635C34.706 6.98863 34.8764 6.20075 35.2174 5.52272C35.562 4.8409 36.0431 4.31059 36.6605 3.93181C37.278 3.54923 38.0033 3.35794 38.8367 3.35794C39.3745 3.35794 39.8821 3.44506 40.3594 3.61931C40.8405 3.78976 41.2647 4.05491 41.6321 4.41476C42.0033 4.77461 42.295 5.23294 42.5071 5.78976C42.7192 6.34279 42.8253 7.00188 42.8253 7.76703V8.39772H35.6719V7.01135H40.8537C40.8499 6.61741 40.7647 6.26703 40.598 5.96022C40.4314 5.64961 40.1984 5.40529 39.8992 5.22726C39.6037 5.04923 39.259 4.96022 38.8651 4.96022C38.4446 4.96022 38.0753 5.06249 37.7571 5.26703C37.4389 5.46779 37.1908 5.73294 37.0128 6.06249C36.8386 6.38825 36.7495 6.7462 36.7458 7.13635V8.34658C36.7458 8.85416 36.8386 9.28976 37.0242 9.6534C37.2098 10.0132 37.4692 10.2898 37.8026 10.4829C38.1359 10.6723 38.5261 10.767 38.973 10.767C39.2723 10.767 39.5431 10.7254 39.7855 10.642C40.028 10.5549 40.2382 10.428 40.4162 10.2614C40.5942 10.0947 40.7287 9.88825 40.8196 9.64203L42.7401 9.85794C42.6189 10.3655 42.3878 10.8087 42.0469 11.1875C41.7098 11.5625 41.278 11.8542 40.7514 12.0625C40.2249 12.267 39.6227 12.3693 38.9446 12.3693ZM54.9489 3.76135C54.8959 3.26514 54.6724 2.87878 54.2784 2.60226C53.8883 2.32575 53.3807 2.18749 52.7557 2.18749C52.3163 2.18749 51.9394 2.25378 51.625 2.38635C51.3106 2.51893 51.0701 2.69885 50.9034 2.92612C50.7368 3.1534 50.6515 3.41287 50.6477 3.70453C50.6477 3.94696 50.7027 4.15719 50.8125 4.33522C50.9262 4.51325 51.0796 4.66476 51.2727 4.78976C51.4659 4.91097 51.6799 5.01325 51.9148 5.09658C52.1496 5.17991 52.3864 5.24999 52.625 5.30681L53.7159 5.57953C54.1553 5.68181 54.5777 5.82006 54.983 5.99431C55.3921 6.16855 55.7576 6.38825 56.0796 6.6534C56.4053 6.91855 56.6629 7.23863 56.8523 7.61363C57.0417 7.98863 57.1364 8.42802 57.1364 8.93181C57.1364 9.61363 56.9621 10.214 56.6137 10.7329C56.2652 11.2481 55.7614 11.6515 55.1023 11.9432C54.447 12.231 53.6534 12.375 52.7216 12.375C51.8163 12.375 51.0303 12.2348 50.3637 11.9545C49.7008 11.6742 49.1818 11.2651 48.8068 10.7273C48.4356 10.1894 48.2349 9.53408 48.2046 8.76135H50.2784C50.3087 9.16666 50.4337 9.50378 50.6534 9.77272C50.8731 10.0417 51.1591 10.2424 51.5114 10.375C51.8674 10.5076 52.2652 10.5739 52.7046 10.5739C53.1629 10.5739 53.5644 10.5057 53.9091 10.3693C54.2576 10.2292 54.5303 10.036 54.7273 9.78976C54.9243 9.53976 55.0246 9.24809 55.0284 8.91476C55.0246 8.61173 54.9356 8.36173 54.7614 8.16476C54.5871 7.964 54.3428 7.79734 54.0284 7.66476C53.7178 7.5284 53.3542 7.40719 52.9375 7.30113L51.6137 6.96022C50.6553 6.714 49.8977 6.3409 49.3409 5.8409C48.7879 5.33711 48.5114 4.66855 48.5114 3.83522C48.5114 3.14961 48.697 2.54923 49.0682 2.03408C49.4432 1.51893 49.9527 1.11931 50.5966 0.835216C51.2406 0.547337 51.9697 0.403398 52.7841 0.403398C53.6099 0.403398 54.3334 0.547337 54.9546 0.835216C55.5796 1.11931 56.0701 1.51514 56.4262 2.02272C56.7822 2.5265 56.9659 3.10605 56.9773 3.76135H54.9489ZM60.9816 7.08522V12.1989H58.9247V0.562489H60.9361V4.95453H61.0384C61.2429 4.46211 61.5592 4.07385 61.9872 3.78976C62.4191 3.50188 62.9683 3.35794 63.635 3.35794C64.241 3.35794 64.7694 3.48484 65.2202 3.73862C65.671 3.99241 66.0194 4.36362 66.2656 4.85226C66.5156 5.3409 66.6406 5.93749 66.6406 6.64203V12.1989H64.5838V6.96022C64.5838 6.37309 64.4323 5.91666 64.1293 5.5909C63.83 5.26135 63.4096 5.09658 62.8679 5.09658C62.5043 5.09658 62.1785 5.17613 61.8906 5.33522C61.6066 5.49052 61.3831 5.7159 61.2202 6.01135C61.0611 6.30681 60.9816 6.66476 60.9816 7.08522ZM72.6009 12.3693C71.7259 12.3693 70.9702 12.1875 70.3338 11.8239C69.7013 11.4564 69.2145 10.9375 68.8736 10.267C68.5327 9.59279 68.3622 8.79923 68.3622 7.88635C68.3622 6.98863 68.5327 6.20075 68.8736 5.52272C69.2183 4.8409 69.6994 4.31059 70.3168 3.93181C70.9342 3.54923 71.6596 3.35794 72.4929 3.35794C73.0308 3.35794 73.5384 3.44506 74.0156 3.61931C74.4967 3.78976 74.921 4.05491 75.2884 4.41476C75.6596 4.77461 75.9513 5.23294 76.1634 5.78976C76.3755 6.34279 76.4816 7.00188 76.4816 7.76703V8.39772H69.3281V7.01135H74.51C74.5062 6.61741 74.421 6.26703 74.2543 5.96022C74.0876 5.64961 73.8547 5.40529 73.5554 5.22726C73.26 5.04923 72.9153 4.96022 72.5213 4.96022C72.1009 4.96022 71.7316 5.06249 71.4134 5.26703C71.0952 5.46779 70.8471 5.73294 70.6691 6.06249C70.4948 6.38825 70.4058 6.7462 70.402 7.13635V8.34658C70.402 8.85416 70.4948 9.28976 70.6804 9.6534C70.866 10.0132 71.1255 10.2898 71.4588 10.4829C71.7922 10.6723 72.1823 10.767 72.6293 10.767C72.9285 10.767 73.1994 10.7254 73.4418 10.642C73.6842 10.5549 73.8944 10.428 74.0725 10.2614C74.2505 10.0947 74.385 9.88825 74.4759 9.64203L76.3963 9.85794C76.2751 10.3655 76.0441 10.8087 75.7031 11.1875C75.366 11.5625 74.9342 11.8542 74.4077 12.0625C73.8812 12.267 73.2789 12.3693 72.6009 12.3693ZM80.2784 0.562489V12.1989H78.2216V0.562489H80.2784ZM86.8139 3.47158V5.06249H81.6549V3.47158H86.8139ZM82.9446 12.1989V2.64772C82.9446 2.06059 83.0658 1.57196 83.3083 1.18181C83.5545 0.791655 83.884 0.499989 84.2969 0.306807C84.7098 0.113625 85.1681 0.0170336 85.6719 0.0170336C86.028 0.0170336 86.3442 0.0454429 86.6208 0.102262C86.8973 0.15908 87.1018 0.210216 87.2344 0.255671L86.8253 1.84658C86.7382 1.82006 86.6283 1.79355 86.4958 1.76703C86.3632 1.73673 86.2155 1.72158 86.0526 1.72158C85.67 1.72158 85.3992 1.81438 85.2401 1.99999C85.0848 2.18181 85.0071 2.44317 85.0071 2.78408V12.1989H82.9446ZM98.8083 3.76135C98.7552 3.26514 98.5317 2.87878 98.1378 2.60226C97.7477 2.32575 97.2401 2.18749 96.6151 2.18749C96.1757 2.18749 95.7988 2.25378 95.4844 2.38635C95.17 2.51893 94.9295 2.69885 94.7628 2.92612C94.5961 3.1534 94.5109 3.41287 94.5071 3.70453C94.5071 3.94696 94.562 4.15719 94.6719 4.33522C94.7855 4.51325 94.9389 4.66476 95.1321 4.78976C95.3253 4.91097 95.5393 5.01325 95.7742 5.09658C96.009 5.17991 96.2458 5.24999 96.4844 5.30681L97.5753 5.57953C98.0147 5.68181 98.437 5.82006 98.8424 5.99431C99.2514 6.16855 99.617 6.38825 99.9389 6.6534C100.265 6.91855 100.522 7.23863 100.712 7.61363C100.901 7.98863 100.996 8.42802 100.996 8.93181C100.996 9.61363 100.822 10.214 100.473 10.7329C100.125 11.2481 99.6208 11.6515 98.9617 11.9432C98.3064 12.231 97.5128 12.375 96.581 12.375C95.6757 12.375 94.8897 12.2348 94.223 11.9545C93.5602 11.6742 93.0412 11.2651 92.6662 10.7273C92.295 10.1894 92.0942 9.53408 92.0639 8.76135H94.1378C94.1681 9.16666 94.2931 9.50378 94.5128 9.77272C94.7325 10.0417 95.0185 10.2424 95.3708 10.375C95.7268 10.5076 96.1245 10.5739 96.5639 10.5739C97.0223 10.5739 97.4238 10.5057 97.7685 10.3693C98.117 10.2292 98.3897 10.036 98.5867 9.78976C98.7836 9.53976 98.884 9.24809 98.8878 8.91476C98.884 8.61173 98.795 8.36173 98.6208 8.16476C98.4465 7.964 98.2022 7.79734 97.8878 7.66476C97.5772 7.5284 97.2136 7.40719 96.7969 7.30113L95.473 6.96022C94.5147 6.714 93.7571 6.3409 93.2003 5.8409C92.6473 5.33711 92.3708 4.66855 92.3708 3.83522C92.3708 3.14961 92.5564 2.54923 92.9276 2.03408C93.3026 1.51893 93.812 1.11931 94.456 0.835216C95.0999 0.547337 95.8291 0.403398 96.6435 0.403398C97.4692 0.403398 98.1927 0.547337 98.8139 0.835216C99.4389 1.11931 99.9295 1.51514 100.286 2.02272C100.642 2.5265 100.825 3.10605 100.837 3.76135H98.8083ZM102.784 15.4716V3.47158H104.807V4.91476H104.926C105.032 4.70264 105.182 4.47726 105.375 4.23863C105.568 3.9962 105.83 3.78976 106.159 3.61931C106.489 3.44506 106.909 3.35794 107.42 3.35794C108.095 3.35794 108.703 3.53029 109.244 3.87499C109.79 4.2159 110.222 4.72158 110.54 5.39203C110.862 6.0587 111.023 6.87688 111.023 7.84658C111.023 8.80491 110.866 9.61931 110.551 10.2898C110.237 10.9602 109.809 11.4716 109.267 11.8239C108.725 12.1761 108.112 12.3523 107.426 12.3523C106.926 12.3523 106.511 12.2689 106.182 12.1023C105.852 11.9356 105.587 11.7348 105.386 11.5C105.189 11.2614 105.036 11.036 104.926 10.8239H104.841V15.4716H102.784ZM104.801 7.83522C104.801 8.39961 104.881 8.89393 105.04 9.31817C105.203 9.74241 105.436 10.0739 105.739 10.3125C106.045 10.5473 106.417 10.6648 106.852 10.6648C107.307 10.6648 107.688 10.5435 107.994 10.3011C108.301 10.0549 108.532 9.71969 108.688 9.29544C108.847 8.86741 108.926 8.38067 108.926 7.83522C108.926 7.29355 108.849 6.81249 108.693 6.39203C108.538 5.97158 108.307 5.64203 108 5.4034C107.693 5.16476 107.311 5.04544 106.852 5.04544C106.413 5.04544 106.04 5.16097 105.733 5.39203C105.426 5.62309 105.193 5.94696 105.034 6.36363C104.879 6.78029 104.801 7.27082 104.801 7.83522ZM115.295 12.375C114.742 12.375 114.244 12.2765 113.801 12.0795C113.362 11.8788 113.013 11.5833 112.756 11.1932C112.502 10.803 112.375 10.322 112.375 9.74999C112.375 9.25756 112.466 8.85037 112.648 8.5284C112.83 8.20643 113.078 7.94885 113.392 7.75567C113.706 7.56249 114.061 7.41666 114.455 7.31817C114.852 7.2159 115.263 7.14203 115.688 7.09658C116.199 7.04355 116.614 6.9962 116.932 6.95453C117.25 6.90908 117.481 6.8409 117.625 6.74999C117.773 6.65529 117.847 6.50946 117.847 6.31249V6.2784C117.847 5.85037 117.72 5.51893 117.466 5.28408C117.212 5.04923 116.847 4.93181 116.369 4.93181C115.866 4.93181 115.466 5.04166 115.17 5.26135C114.879 5.48105 114.682 5.74052 114.58 6.03976L112.659 5.76703C112.811 5.23673 113.061 4.79355 113.409 4.43749C113.758 4.07764 114.184 3.8087 114.688 3.63067C115.191 3.44885 115.748 3.35794 116.358 3.35794C116.778 3.35794 117.197 3.40719 117.614 3.50567C118.03 3.60416 118.411 3.76703 118.756 3.99431C119.1 4.21779 119.377 4.52272 119.585 4.90908C119.797 5.29544 119.903 5.7784 119.903 6.35794V12.1989H117.926V11H117.858C117.733 11.2424 117.557 11.4697 117.33 11.6818C117.106 11.8901 116.824 12.0587 116.483 12.1875C116.146 12.3125 115.75 12.375 115.295 12.375ZM115.83 10.8636C116.242 10.8636 116.6 10.7822 116.903 10.6193C117.206 10.4526 117.439 10.2329 117.602 9.96022C117.769 9.68749 117.852 9.39014 117.852 9.06817V8.03976C117.788 8.09279 117.678 8.14203 117.523 8.18749C117.371 8.23294 117.201 8.27272 117.011 8.30681C116.822 8.3409 116.634 8.3712 116.449 8.39772C116.263 8.42423 116.102 8.44696 115.966 8.4659C115.659 8.50756 115.384 8.57575 115.142 8.67044C114.9 8.76514 114.708 8.89772 114.568 9.06817C114.428 9.23484 114.358 9.45075 114.358 9.7159C114.358 10.0947 114.496 10.3807 114.773 10.5739C115.049 10.767 115.402 10.8636 115.83 10.8636ZM125.778 12.3693C124.907 12.3693 124.159 12.178 123.534 11.7954C122.913 11.4129 122.434 10.8845 122.097 10.2102C121.763 9.53219 121.597 8.75188 121.597 7.86931C121.597 6.98294 121.767 6.20075 122.108 5.52272C122.449 4.8409 122.93 4.31059 123.551 3.93181C124.176 3.54923 124.915 3.35794 125.767 3.35794C126.475 3.35794 127.102 3.48863 127.648 3.74999C128.197 4.00756 128.634 4.37309 128.96 4.84658C129.286 5.31628 129.472 5.86552 129.517 6.49431H127.551C127.472 6.07385 127.282 5.72347 126.983 5.44317C126.688 5.15908 126.292 5.01703 125.795 5.01703C125.375 5.01703 125.006 5.13067 124.688 5.35794C124.369 5.58143 124.121 5.9034 123.943 6.32385C123.769 6.74431 123.682 7.24809 123.682 7.83522C123.682 8.42991 123.769 8.94128 123.943 9.36931C124.117 9.79355 124.362 10.1212 124.676 10.3523C124.994 10.5795 125.367 10.6932 125.795 10.6932C126.099 10.6932 126.369 10.6364 126.608 10.5227C126.85 10.4053 127.053 10.2367 127.216 10.017C127.379 9.79734 127.491 9.53029 127.551 9.2159H129.517C129.468 9.83332 129.286 10.3807 128.972 10.8579C128.657 11.3314 128.229 11.7026 127.688 11.9716C127.146 12.2367 126.509 12.3693 125.778 12.3693ZM135.07 12.3693C134.195 12.3693 133.439 12.1875 132.803 11.8239C132.17 11.4564 131.683 10.9375 131.342 10.267C131.001 9.59279 130.831 8.79923 130.831 7.88635C130.831 6.98863 131.001 6.20075 131.342 5.52272C131.687 4.8409 132.168 4.31059 132.786 3.93181C133.403 3.54923 134.128 3.35794 134.962 3.35794C135.5 3.35794 136.007 3.44506 136.484 3.61931C136.965 3.78976 137.39 4.05491 137.757 4.41476C138.128 4.77461 138.42 5.23294 138.632 5.78976C138.844 6.34279 138.95 7.00188 138.95 7.76703V8.39772H131.797V7.01135H136.979C136.975 6.61741 136.89 6.26703 136.723 5.96022C136.556 5.64961 136.323 5.40529 136.024 5.22726C135.729 5.04923 135.384 4.96022 134.99 4.96022C134.57 4.96022 134.2 5.06249 133.882 5.26703C133.564 5.46779 133.316 5.73294 133.138 6.06249C132.964 6.38825 132.875 6.7462 132.871 7.13635V8.34658C132.871 8.85416 132.964 9.28976 133.149 9.6534C133.335 10.0132 133.594 10.2898 133.928 10.4829C134.261 10.6723 134.651 10.767 135.098 10.767C135.397 10.767 135.668 10.7254 135.911 10.642C136.153 10.5549 136.363 10.428 136.541 10.2614C136.719 10.0947 136.854 9.88825 136.945 9.64203L138.865 9.85794C138.744 10.3655 138.513 10.8087 138.172 11.1875C137.835 11.5625 137.403 11.8542 136.876 12.0625C136.35 12.267 135.748 12.3693 135.07 12.3693ZM146.858 0.562489V12.1989H144.75V0.562489H146.858ZM151.107 7.08522V12.1989H149.05V3.47158H151.016V4.95453H151.118C151.319 4.4659 151.639 4.07764 152.078 3.78976C152.521 3.50188 153.069 3.35794 153.72 3.35794C154.322 3.35794 154.847 3.48673 155.294 3.74431C155.745 4.00188 156.093 4.37499 156.34 4.86363C156.59 5.35226 156.713 5.94506 156.709 6.64203V12.1989H154.652V6.96022C154.652 6.37688 154.5 5.92044 154.197 5.5909C153.898 5.26135 153.483 5.09658 152.953 5.09658C152.593 5.09658 152.273 5.17613 151.993 5.33522C151.716 5.49052 151.499 5.7159 151.34 6.01135C151.184 6.30681 151.107 6.66476 151.107 7.08522ZM162.607 12.3693C161.735 12.3693 160.987 12.178 160.362 11.7954C159.741 11.4129 159.262 10.8845 158.925 10.2102C158.591 9.53219 158.425 8.75188 158.425 7.86931C158.425 6.98294 158.595 6.20075 158.936 5.52272C159.277 4.8409 159.758 4.31059 160.379 3.93181C161.004 3.54923 161.743 3.35794 162.595 3.35794C163.304 3.35794 163.93 3.48863 164.476 3.74999C165.025 4.00756 165.463 4.37309 165.788 4.84658C166.114 5.31628 166.3 5.86552 166.345 6.49431H164.379C164.3 6.07385 164.11 5.72347 163.811 5.44317C163.516 5.15908 163.12 5.01703 162.624 5.01703C162.203 5.01703 161.834 5.13067 161.516 5.35794C161.197 5.58143 160.949 5.9034 160.771 6.32385C160.597 6.74431 160.51 7.24809 160.51 7.83522C160.51 8.42991 160.597 8.94128 160.771 9.36931C160.946 9.79355 161.19 10.1212 161.504 10.3523C161.822 10.5795 162.196 10.6932 162.624 10.6932C162.927 10.6932 163.197 10.6364 163.436 10.5227C163.679 10.4053 163.881 10.2367 164.044 10.017C164.207 9.79734 164.319 9.53029 164.379 9.2159H166.345C166.296 9.83332 166.114 10.3807 165.8 10.8579C165.485 11.3314 165.057 11.7026 164.516 11.9716C163.974 12.2367 163.338 12.3693 162.607 12.3693ZM169.301 12.3239C168.956 12.3239 168.661 12.2026 168.415 11.9602C168.169 11.7178 168.047 11.4223 168.051 11.0739C168.047 10.7329 168.169 10.4413 168.415 10.1989C168.661 9.95643 168.956 9.83522 169.301 9.83522C169.634 9.83522 169.924 9.95643 170.17 10.1989C170.42 10.4413 170.547 10.7329 170.551 11.0739C170.547 11.3049 170.487 11.5151 170.369 11.7045C170.256 11.8939 170.104 12.0454 169.915 12.1591C169.729 12.2689 169.525 12.3239 169.301 12.3239Z"
            fill="white"
          />
        </svg>
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

      <AddBrandModal
        open={addBrandOpen}
        brands={brands}
        onClose={() => setAddBrandOpen(false)}
        onCreated={onBrandCreated}
      />
    </div>
  );
}
