/**
 * Presets for the dashboard's "This Month" selector — resolved to concrete
 * UTC bounds here rather than sent as an enum to the API, so adding a
 * preset never needs a backend change (DashboardController just takes
 * `from`/`to`).
 */
export const DATE_RANGE_PRESETS = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_year: 'This Year',
};

export function isDateRangePreset(value: string | undefined): value is DateRangePreset {
  return DATE_RANGE_PRESETS.includes(value as DateRangePreset);
}

/** `end` is exclusive throughout — matches DashboardService's own bounds. */
export function rangeBoundsFor(
  preset: DateRangePreset,
  now = new Date(),
): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const quarter = Math.floor(month / 3);

  switch (preset) {
    case 'this_month':
      return {
        start: new Date(Date.UTC(year, month, 1)),
        end: new Date(Date.UTC(year, month + 1, 1)),
      };
    case 'last_month':
      return {
        start: new Date(Date.UTC(year, month - 1, 1)),
        end: new Date(Date.UTC(year, month, 1)),
      };
    case 'this_quarter':
      return {
        start: new Date(Date.UTC(year, quarter * 3, 1)),
        end: new Date(Date.UTC(year, quarter * 3 + 3, 1)),
      };
    case 'last_quarter':
      return {
        start: new Date(Date.UTC(year, quarter * 3 - 3, 1)),
        end: new Date(Date.UTC(year, quarter * 3, 1)),
      };
    case 'this_year':
      return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
}
