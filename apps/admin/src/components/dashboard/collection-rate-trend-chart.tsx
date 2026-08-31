'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { palette } from '@fenwick/shared/tokens';
import type { DashboardTrendPoint } from '@/lib/api';

/** A single series names itself via the card title — no legend needed. */
export function CollectionRateTrendChart({ trend }: { trend: DashboardTrendPoint[] }) {
  const data = trend.map((point) => ({ label: point.label, rate: point.collectionRate * 100 }));

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-medium text-ink-strong">Collection Rate Trend</h2>
      <p className="mb-4 text-xs text-ink-subtle">6-months lookback</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke={palette.border} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: palette.inkSubtle, fontSize: 12 }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: palette.inkSubtle, fontSize: 12 }}
          />
          <Tooltip
            formatter={(value: number) => [`${value.toFixed(1)}%`, 'Collection rate']}
            contentStyle={{
              borderRadius: 8,
              borderColor: palette.border,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke={palette.inkStrong}
            strokeWidth={2}
            dot={{ r: 3, fill: palette.inkStrong, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
