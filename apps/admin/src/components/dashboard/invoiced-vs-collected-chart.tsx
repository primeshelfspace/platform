'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { formatMinorCompact, formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import { palette } from '@fenwick/shared/tokens';
import type { DashboardTrendPoint } from '@/lib/api';

/** Fixed two-series order, never cycled: Invoiced then Collected, same order
 * as the legend and the mockup. */
const SERIES = [
  { key: 'invoicedMinor', label: 'Invoiced', color: palette.inkStrong },
  { key: 'collectedMinor', label: 'Collected', color: palette.accent },
] as const;

export function InvoicedVsCollectedChart({
  trend,
  currency,
}: {
  trend: DashboardTrendPoint[];
  currency: string;
}) {
  const code = toCurrencyCode(currency);
  const hasData = trend.some((point) => point.invoicedMinor > 0 || point.collectedMinor > 0);
  const data = trend.map((point) => ({
    label: point.label,
    invoicedMinor: point.invoicedMinor,
    collectedMinor: point.collectedMinor,
  }));

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-strong">Invoiced vs Collected</h2>
          <p className="text-xs text-ink-subtle">
            6-months lookback — Gap between billed and received
          </p>
        </div>
        <ul className="flex shrink-0 items-center gap-4">
          {SERIES.map((series) => (
            <li
              key={series.key}
              className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: series.color }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: series.color }}
                aria-hidden
              />
              {series.label}
            </li>
          ))}
        </ul>
      </div>
      {!hasData ? (
        <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
          <BarChart3 className="h-8 w-8 text-ink-subtle" aria-hidden />
          <p className="text-sm text-ink-subtle">No billing activity recorded yet.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={4}>
            <CartesianGrid vertical={false} stroke={palette.border} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.ink, fontSize: 12, fontWeight: 600 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.ink, fontSize: 12, fontWeight: 600 }}
              tickFormatter={(v: number) => formatMinorCompact(v, code)}
              width={56}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatMinorForDisplay(value, code),
                name,
              ]}
              contentStyle={{ borderRadius: 8, borderColor: palette.border, fontSize: 12 }}
            />
            {/* Rendered Collected-then-Invoiced (reversed from the legend's
                Invoiced-first order) — that's the bar order the design
                calls for: green to the left of black in every month group. */}
            {[...SERIES].reverse().map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
