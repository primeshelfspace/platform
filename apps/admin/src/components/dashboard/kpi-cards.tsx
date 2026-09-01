import { AlertCircle, ArrowDownToLine, Percent, Receipt } from 'lucide-react';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { DashboardSummary } from '@/lib/api';

function Card({
  icon: Icon,
  label,
  value,
  sublabel,
  tone = 'default',
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
  sublabel: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div
      className={`rounded-lg border p-5 shadow-sm ${
        tone === 'danger' ? 'border-danger/30 bg-danger-surface' : 'border-border bg-surface'
      }`}
    >
      <div
        className={`mb-2 flex items-center gap-2 ${tone === 'danger' ? 'text-danger' : 'text-ink-muted'}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink-strong'}`}
      >
        {value}
      </p>
      <p className={`mt-1 text-xs ${tone === 'danger' ? 'text-danger/80' : 'text-ink-subtle'}`}>
        {sublabel}
      </p>
    </div>
  );
}

export function KpiCards({
  summary,
  rangeLabel,
}: {
  summary: DashboardSummary;
  /** e.g. "This Month" / "Last Quarter" — the header's date-range selector. */
  rangeLabel: string;
}) {
  const currency = toCurrencyCode(summary.currency);
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        icon={Receipt}
        label="Invoiced"
        value={formatMinorForDisplay(summary.invoicedMinor, currency)}
        sublabel={rangeLabel}
      />
      <Card
        icon={ArrowDownToLine}
        label="Collected"
        value={formatMinorForDisplay(summary.collectedMinor, currency)}
        sublabel={rangeLabel}
      />
      <Card
        icon={Percent}
        label="Collection Rate"
        value={summary.invoicedMinor > 0 ? `${(summary.collectionRate * 100).toFixed(1)}%` : '—'}
        sublabel={rangeLabel}
      />
      <Card
        icon={AlertCircle}
        label="Overdue"
        value={formatMinorForDisplay(summary.overdueMinor, currency)}
        sublabel="As of today"
        tone="danger"
      />
      {summary.otherCurrencyBrandCount > 0 && (
        <p className="col-span-full text-xs text-ink-subtle">
          Showing {currency} only — {summary.otherCurrencyBrandCount} other brand
          {summary.otherCurrencyBrandCount === 1 ? '' : 's'} use a different currency.
        </p>
      )}
    </div>
  );
}
