'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import { palette } from '@fenwick/shared/tokens';
import type { DashboardStatusBucket, DashboardStatusBucketName } from '@/lib/api';

/** Status colours, reused verbatim from the same statusTone vocabulary the
 * invoice list and detail screens already chip with — not a new palette. */
const BUCKET_COLOR: Record<DashboardStatusBucketName, string> = {
  Paid: palette.success,
  Unpaid: palette.info,
  Overdue: palette.danger,
  'Partially Paid': palette.warning,
  Draft: palette.inkSubtle,
};

export function InvoiceStatusDonut({
  buckets,
  currency,
}: {
  buckets: DashboardStatusBucket[];
  currency: string;
}) {
  const code = toCurrencyCode(currency);
  const hasData = buckets.some((b) => b.amountMinor > 0);

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <h2 className="mb-6 text-lg font-semibold text-ink-strong">Invoice Status</h2>
      {!hasData ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <PieChartIcon className="h-8 w-8 text-ink-subtle" aria-hidden />
          <p className="text-sm text-ink-subtle">No invoices to break down yet.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={buckets}
                  dataKey="amountMinor"
                  nameKey="bucket"
                  innerRadius={68}
                  outerRadius={104}
                  paddingAngle={2}
                  cornerRadius={4}
                  stroke={palette.surface}
                  strokeWidth={2}
                >
                  {buckets.map((bucket) => (
                    <Cell key={bucket.bucket} fill={BUCKET_COLOR[bucket.bucket]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatMinorForDisplay(value, code),
                    name,
                  ]}
                  contentStyle={{ borderRadius: 8, borderColor: palette.border, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="w-full space-y-3">
            {buckets.map((bucket) => (
              <li key={bucket.bucket} className="flex items-center gap-2.5 text-sm">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: BUCKET_COLOR[bucket.bucket] }}
                  aria-hidden
                />
                <span className="flex-1 text-ink-muted">{bucket.bucket}</span>
                <span className="text-base font-semibold text-ink-strong">
                  {formatMinorForDisplay(bucket.amountMinor, code)}
                </span>
                <span className="w-10 text-right text-sm text-ink-subtle">
                  {Math.round(bucket.percent * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
