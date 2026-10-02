'use client';

/** Inline rather than pulled from an icon library — @sugrpay/ui has zero
 * runtime dependencies beyond React, and the payment app (this package's
 * other consumer) doesn't carry lucide-react. */
function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The page-size choices every paginated list in the app offers — one shared
 * list so "10/25/50/100" never drifts between screens. */
export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  pageSize: number;
  /** Total matching records across every page, not just this one. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** Plural noun for the "Showing X–Y of Z" caption, e.g. "invoices". */
  itemLabel?: string;
  className?: string;
}

/** first, last, current-1..current+1, with `null` standing in for an
 * ellipsis — e.g. [1, null, 4, 5, 6, null, 20]. Never longer than 7 entries. */
function pageWindow(current: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const result: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) result.push(null);
    result.push(p);
    previous = p;
  }
  return result;
}

/**
 * Reusable Previous/Next + page-number + page-size control, driven entirely
 * by props — the caller owns where page/pageSize actually live (a URL query
 * param everywhere it's used today) and re-fetches when they change. Renders
 * nothing once there is only a single page of results, matching the plain
 * "Showing X of Y" captions this replaced.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  itemLabel = 'results',
  className = '',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  if (total === 0) return null;

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] px-4 py-3 text-sm ${className}`}
    >
      <div className="flex items-center gap-3 text-[#64748B]">
        <span>
          Showing <span className="font-medium text-[#0F172A]">{start}</span>–
          <span className="font-medium text-[#0F172A]">{end}</span> of{' '}
          <span className="font-medium text-[#0F172A]">{total}</span> {itemLabel}
        </span>

        <label className="flex items-center gap-1.5">
          <span className="sr-only sm:not-sr-only">Rows per page</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border border-[#D4D4D4] bg-white px-2 text-sm text-[#0F172A]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900
                       focus-visible:ring-offset-1"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D4D4D4] bg-white
                       text-[#0F172A] transition-colors hover:bg-surface-muted disabled:cursor-not-allowed
                       disabled:opacity-40"
          >
            <ChevronLeftIcon />
          </button>

          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`ellipsis-${i}`} className="px-1 text-[#94A3B8]">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => onPageChange(p)}
                className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors ${
                  p === page
                    ? 'bg-[#0F172A] text-white'
                    : 'border border-[#D4D4D4] bg-white text-[#0F172A] hover:bg-surface-muted'
                }`}
              >
                {p}
              </button>
            ),
          )}

          <button
            type="button"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D4D4D4] bg-white
                       text-[#0F172A] transition-colors hover:bg-surface-muted disabled:cursor-not-allowed
                       disabled:opacity-40"
          >
            <ChevronRightIcon />
          </button>
        </div>
      )}
    </nav>
  );
}
