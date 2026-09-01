'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, ChevronDown } from 'lucide-react';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { DATE_RANGE_LABELS, DATE_RANGE_PRESETS, type DateRangePreset } from '@/lib/date-range';

/** The dashboard's own "This Month" selector — scopes the KPI cards and By
 * Brand rollup only; the two 6-month trend charts have a fixed lookback of
 * their own and are deliberately not affected by this (their captions never
 * change with it). Same open/close/outside-click shape as the invoices
 * list's own date-range menu (invoices-page-client.tsx). */
export function DateRangeSelect({ current }: { current: DateRangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useDismissablePanel<HTMLDivElement>(open, () => setOpen(false));

  function onSelect(preset: DateRangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', preset);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

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
        <Calendar className="h-4 w-4 text-ink-muted" aria-hidden />
        {DATE_RANGE_LABELS[current]}
        <ChevronDown className="h-4 w-4 text-ink-muted" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Date range"
          className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-border
                     bg-surface py-1 shadow-lg"
        >
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitem"
              onClick={() => onSelect(preset)}
              className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted ${
                preset === current ? 'font-semibold text-ink-strong' : 'text-ink-muted'
              }`}
            >
              {DATE_RANGE_LABELS[preset]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
