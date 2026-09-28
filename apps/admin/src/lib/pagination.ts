/** The page-size choices every paginated list page offers — mirrors
 * @fenwick/ui's Pagination component default so a URL's `pageSize` and the
 * control that produced it never disagree about what's valid. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Reads `page`/`pageSize` off a server page's searchParams. Both are
 * user-editable URL state (browser back/forward, a pasted link, a stale
 * bookmark), so this clamps rather than trusts them — an out-of-range or
 * non-numeric value falls back to the first page / default size instead of
 * reaching the API with something invoiceListQuerySchema would 400 on.
 */
export function parsePageParams(params: { page?: string; pageSize?: string }): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
  const rawPageSize = Math.trunc(Number(params.pageSize));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPageSize)
    ? rawPageSize
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}
