'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
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
  const data = trend.map((point) => ({
    label: point.label,
    invoicedMinor: point.invoicedMinor,
    collectedMinor: point.collectedMinor,
  }));

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-medium text-ink-strong">Invoiced vs Collected</h2>
          <p className="text-xs text-ink-subtle">
            6-months lookback — Gap between billed and received
          </p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={4}>
          <CartesianGrid vertical={false} stroke={palette.border} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: palette.inkSubtle, fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: palette.inkSubtle, fontSize: 12 }}
            tickFormatter={(v: number) => formatMinorForDisplay(v, code)}
            width={72}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatMinorForDisplay(value, code), name]}
            contentStyle={{ borderRadius: 8, borderColor: palette.border, fontSize: 12 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: palette.inkMuted }}
          />
          {SERIES.map((series) => (
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
    </div>
  );
}
