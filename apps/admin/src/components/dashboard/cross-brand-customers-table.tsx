import type { Brand, CrossBrandCustomersResult, DashboardStatusBucketName } from '@/lib/api';

const STATUS_TONE: Record<string, string> = {
  Paid: 'text-success',
  Unpaid: 'text-warning',
  Overdue: 'text-danger',
  'Partially Paid': 'text-warning',
  Draft: 'text-ink-subtle',
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-subtle">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm ${STATUS_TONE[status] ?? 'text-ink-muted'}`}
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
    <section className="mb-6 rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="font-medium text-ink-strong">Customers Across Multiple Brands</h2>
          <p className="text-xs text-ink-subtle">Matched by email — present in 2 or more brands</p>
        </div>
        <span className="text-xs text-ink-subtle">{result.matchedCount} matched</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              <th className="px-5 py-3">Customer</th>
              {brands.map((brand) => (
                <th key={brand.id} className="px-5 py-3">
                  {brand.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.email} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <p className="font-medium text-ink-strong">{row.displayName}</p>
                  <p className="text-xs text-ink-subtle">{row.email}</p>
                </td>
                {brands.map((brand) => (
                  <td key={brand.id} className="px-5 py-3">
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
