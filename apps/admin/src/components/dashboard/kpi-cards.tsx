import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { DashboardSummary } from '@/lib/api';

function Card({
  label,
  value,
  sublabel,
  tone = 'default',
}: {
  label: string;
  value: string;
  sublabel: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <div
      className={`rounded-[14px] border px-5 py-4 shadow-[0px_1px_3px_0px_#0000000A] ${
        tone === 'danger' ? 'border-danger/30 bg-danger-surface' : 'border-border bg-surface'
      }`}
    >
      <p className={`mb-0.5 text-sm ${tone === 'danger' ? 'text-danger' : 'text-ink-muted'}`}>
        {label}
      </p>
      <p
        className={
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-[#171717]'
        }
        style={{
          fontFamily: 'var(--font-jakarta)',
          fontWeight: 800,
          fontSize: '26px',
          lineHeight: '100%',
          letterSpacing: '0px',
        }}
      >
        {value}
      </p>
      <p className={`mt-0.5 text-xs ${tone === 'danger' ? 'text-danger/80' : 'text-ink-subtle'}`}>
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
        label="Invoiced"
        value={formatMinorForDisplay(summary.invoicedMinor, currency)}
        sublabel={rangeLabel}
      />
      <Card
        label="Collected"
        value={formatMinorForDisplay(summary.collectedMinor, currency)}
        sublabel={rangeLabel}
        tone="success"
      />
      <Card
        label="Collection Rate"
        value={summary.invoicedMinor > 0 ? `${(summary.collectionRate * 100).toFixed(1)}%` : '—'}
        sublabel={rangeLabel}
      />
      <Card
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
