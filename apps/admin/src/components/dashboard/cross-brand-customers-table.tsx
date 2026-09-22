import type { Brand, CrossBrandCustomersResult, DashboardStatusBucketName } from '@/lib/api';

/** Same status→tone vocabulary as the Invoice Status donut (`BUCKET_COLOR` in
 * invoice-status-donut.tsx) — a status must read as the same color everywhere
 * it appears on the dashboard. */
const STATUS_TONE: Record<string, string> = {
  Paid: 'text-success',
  Unpaid: 'text-info',
  Overdue: 'text-danger',
  'Partially Paid': 'text-warning',
  Draft: 'text-ink-subtle',
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-subtle">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${STATUS_TONE[status] ?? 'text-ink-muted'}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status as DashboardStatusBucketName}
    </span>
  );
}

/** Only rendered in All Brands mode — matching customers across brands is
 * meaningless once one brand is selected. */
export function CrossBrandCustomersTable({
  result,
  brands,
}: {
  result: CrossBrandCustomersResult;
  brands: Brand[];
}) {
  if (result.rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-[14px] border border-[#E5E5E5] bg-surface p-8 shadow-[0px_1px_3px_0px_#0000000A]">
      <div className="mb-5">
        <div className="flex items-center justify-between pb-5">
          <div>
            <h2 className="text-lg font-semibold leading-none text-ink-strong">
              Customers Across Multiple Brands
            </h2>
            <p
              className="mt-1 text-[12px] font-medium leading-none tracking-normal text-ink-subtle"
              style={{ fontFamily: 'var(--font-jakarta)' }}
            >
              Matched by email — present in 2 or more brands
            </p>
          </div>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold text-ink-muted">
            {result.matchedCount} matched
          </span>
        </div>
        {/* Full-bleed to the card's own edge, same pattern as every other
            dashboard card's header divider. */}
        <div className="-mx-8 border-b border-[#E5E5E5]" />
      </div>

      <div className="-mx-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-muted text-left text-sm font-semibold text-ink-muted">
              <th className="px-8 py-3">Customer</th>
              {brands.map((brand) => (
                <th key={brand.id} className="px-8 py-3">
                  {brand.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.email} className="border-b border-[#E5E5E5] last:border-0">
                <td className="px-8 py-3">
                  <p className="font-semibold text-ink-strong">{row.displayName}</p>
                  <p className="text-xs text-ink-subtle">{row.email}</p>
                </td>
                {brands.map((brand) => (
                  <td key={brand.id} className="px-8 py-3">
                    <StatusPill status={row.perBrand[brand.id]?.status ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
