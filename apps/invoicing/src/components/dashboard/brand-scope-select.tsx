'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutGrid, Tag } from 'lucide-react';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import type { Brand } from '@/lib/api';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/**
 * The dashboard header's own brand-scope pill — a second entry point onto
 * the exact same `?brandId=` state the sidebar's brand switcher owns
 * (AdminShell), not an independent selection. Picking a brand here or there
 * lands on the same URL either way, so the two controls can never disagree
 * about what's currently shown.
 */
export function BrandScopeSelect({
  brands,
  activeBrandId,
}: {
  brands: Brand[];
  /** null = "All Brands". */
  activeBrandId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useDismissablePanel<HTMLDivElement>(open, () => setOpen(false));

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  function onSelect(brandId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('brandId', brandId);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  if (brands.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm
                   text-ink-strong shadow-sm hover:bg-surface-muted"
      >
        {activeBrand ? (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ backgroundColor: activeBrand.themeColor }}
            aria-hidden
          >
            {initialOf(activeBrand.displayName)}
          </span>
        ) : (
          <Tag className="h-4 w-4 text-ink-muted" aria-hidden />
        )}
        {activeBrand ? activeBrand.displayName : 'All Brands'}
        <ChevronDown className="h-4 w-4 text-ink-muted" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Brand scope"
          className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-border
                     bg-surface py-1 shadow-lg"
        >
          {brands.length > 1 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onSelect('all')}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted ${
                activeBrandId === null ? 'font-semibold text-ink-strong' : 'text-ink-muted'
              }`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
              All Brands
            </button>
          )}
          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              role="menuitem"
              onClick={() => onSelect(brand.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted ${
                brand.id === activeBrandId ? 'font-semibold text-ink-strong' : 'text-ink-muted'
              }`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                style={{ backgroundColor: brand.themeColor }}
                aria-hidden
              >
                {initialOf(brand.displayName)}
              </span>
              {brand.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
