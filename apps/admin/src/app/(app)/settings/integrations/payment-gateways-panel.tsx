'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Info,
  Link2,
  ShieldCheck,
  Target,
  Unlink,
  X,
} from 'lucide-react';
import { toast } from '@fenwick/ui/toast';
import type {
  PaymentGatewayProvider,
  PaymentGatewaySummary,
  PaymentMethodSettings,
  PaymentTransaction,
  PaymentTransactionListResponse,
} from '@/lib/api';
import { Toggle } from '@/components/ui/toggle';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import { GatewayMark } from './gateway-mark';
import { disconnectPaymentGatewayAction, updatePaymentMethodSettingsAction } from './actions';

/** Only Stripe has a working connect flow right now — PayPal, Square and
 * Authorize.net show "Coming soon" instead of a working Connect button. */
function isConnectable(provider: PaymentGatewayProvider): provider is 'STRIPE' {
  return provider === 'STRIPE';
}

const GATEWAY_DESCRIPTION: Record<PaymentGatewayProvider, string> = {
  STRIPE: 'Card, ACH, Apple Pay & Google Pay — payouts land straight in your Stripe account',
  PAYPAL: 'Accept PayPal and major cards through your own PayPal Business account',
  SQUARE: 'Card payments processed through your existing Square account',
  AUTHORIZE_NET: 'Card and eCheck payments through your Authorize.net merchant account',
};

const METHOD_LABEL: Record<PaymentTransaction['method'], string> = {
  CARD: 'Credit / Debit Card',
  WALLET: 'Digital Wallet',
  ACH: 'ACH Bank Transfer',
  CHECK: 'Uploaded Check',
  MANUAL: 'Manual',
};

const STATUS_STYLE: Record<
  PaymentTransaction['status'],
  { dot: string; text: string; label: string }
> = {
  SETTLED: { dot: 'bg-success', text: 'text-success', label: 'Success' },
  REFUNDED: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Refunded' },
  PARTIALLY_REFUNDED: { dot: 'bg-warning', text: 'text-warning', label: 'Partially refunded' },
  PROCESSING: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Processing' },
  INITIATED: { dot: 'bg-warning', text: 'text-warning', label: 'Pending' },
  FAILED: { dot: 'bg-danger', text: 'text-danger', label: 'Failed' },
  CANCELLED: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Cancelled' },
};

const DATE_RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Brand Settings → Payment Gateways. Once a gateway is connected, the list
 * splits into "Connected" and "Available" sections (only one gateway can be
 * active per brand, so Available exists to explain why the rest are
 * inactive rather than to offer a real second Connect). Before anything is
 * connected, it's a single flat list — there's nothing to split yet.
 *
 * "View Details" on the connected gateway opens its own page: a Disconnect
 * confirmation, this brand's Payment Methods toggles, and its full
 * Transaction Log underneath (the log is deliberately the same table
 * regardless of which gateway is connected — see PaymentsService.list on the
 * API side — so disconnecting one gateway does not erase its history).
 */
export function PaymentGatewaysPanel({
  brandId,
  brandDisplayName,
  brandCurrency,
  basePath,
  stripeConnectUrl,
  initialGateways,
  selected,
  initialMethodSettings,
  initialTransactions,
}: {
  brandId: string;
  brandDisplayName: string;
  brandCurrency: string;
  /** Where this panel's own list/detail links point — the page embedding it
   * owns the tab query param(s) that get this panel rendered in the first
   * place, so the panel itself doesn't hardcode which page that is. */
  basePath: string;
  stripeConnectUrl: string;
  initialGateways: PaymentGatewaySummary[];
  selected: PaymentGatewayProvider | null;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
}) {
  const [gateways, setGateways] = useState(initialGateways);
  const listHref = `${basePath}&brandId=${brandId}`;

  const selectedGateway = selected ? gateways.find((g) => g.provider === selected) : null;

  return !selected || !selectedGateway ? (
    <GatewayList
      brandDisplayName={brandDisplayName}
      brandCurrency={brandCurrency}
      listHref={listHref}
      gateways={gateways}
      stripeConnectUrl={stripeConnectUrl}
    />
  ) : (
    <GatewayDetail
      brandId={brandId}
      brandDisplayName={brandDisplayName}
      listHref={listHref}
      gateway={selectedGateway}
      initialMethodSettings={initialMethodSettings}
      initialTransactions={initialTransactions}
      onGatewaysChange={setGateways}
    />
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-2"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted">
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      <span className="text-base font-bold text-ink-strong">{label}</span>
    </button>
  );
}

function ConnectedGatewayCard({
  gateway,
  brandDisplayName,
  brandCurrency,
  listHref,
}: {
  gateway: PaymentGatewaySummary;
  brandDisplayName: string;
  brandCurrency: string;
  listHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-4">
        <GatewayMark provider={gateway.provider} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-ink-strong">{gateway.displayName}</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              Connected
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">
            {brandDisplayName} • {brandCurrency} — Standard account
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-success">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Payouts go directly to your {gateway.displayName} account
        </span>
        <Link
          href={`${listHref}&gateway=${gateway.provider.toLowerCase()}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted"
        >
          View Details
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function AvailableGatewayCard({
  gateway,
  stripeConnectUrl,
}: {
  gateway: PaymentGatewaySummary;
  stripeConnectUrl: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-4">
        <GatewayMark provider={gateway.provider} />
        <div>
          <p className="font-bold text-ink-strong">{gateway.displayName}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{GATEWAY_DESCRIPTION[gateway.provider]}</p>
        </div>
      </div>

      {isConnectable(gateway.provider) ? (
        <a
          href={stripeConnectUrl}
          className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2 text-sm font-bold text-white hover:bg-black"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Connect
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="inline-flex shrink-0 cursor-not-allowed items-center gap-2 rounded-[10px] border border-border bg-surface-muted px-4 py-2 text-sm font-bold text-ink-muted"
        >
          Coming soon
        </button>
      )}
    </div>
  );
}

function GatewayList({
  brandDisplayName,
  brandCurrency,
  listHref,
  gateways,
  stripeConnectUrl,
}: {
  brandDisplayName: string;
  brandCurrency: string;
  listHref: string;
  gateways: PaymentGatewaySummary[];
  stripeConnectUrl: string;
}) {
  const [connectedOpen, setConnectedOpen] = useState(true);
  const [availableOpen, setAvailableOpen] = useState(true);

  const connected = gateways.filter((g) => g.connected);
  const available = gateways.filter((g) => !g.connected);

  if (connected.length === 0) {
    return (
      <div className="mt-4 space-y-3">
        {available.map((gateway) => (
          <AvailableGatewayCard
            key={gateway.provider}
            gateway={gateway}
            stripeConnectUrl={stripeConnectUrl}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <section className="space-y-3">
        <SectionHeader
          label="Connected"
          open={connectedOpen}
          onToggle={() => setConnectedOpen((v) => !v)}
        />
        {connectedOpen &&
          connected.map((gateway) => (
            <ConnectedGatewayCard
              key={gateway.provider}
              gateway={gateway}
              brandDisplayName={brandDisplayName}
              brandCurrency={brandCurrency}
              listHref={listHref}
            />
          ))}
      </section>

      <section className="space-y-3">
        <SectionHeader
          label="Available"
          open={availableOpen}
          onToggle={() => setAvailableOpen((v) => !v)}
        />
        {availableOpen && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-info-surface p-3 text-sm text-info">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Only one payment gateway can be active per brand. To connect a different gateway,
                disconnect {connected[0]?.displayName} above first.
              </p>
            </div>
            {available.map((gateway) => (
              <AvailableGatewayCard
                key={gateway.provider}
                gateway={gateway}
                stripeConnectUrl={stripeConnectUrl}
              />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function GatewayDetail({
  brandId,
  brandDisplayName,
  listHref,
  gateway,
  initialMethodSettings,
  initialTransactions,
  onGatewaysChange,
}: {
  brandId: string;
  brandDisplayName: string;
  listHref: string;
  gateway: PaymentGatewaySummary;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
  onGatewaysChange: (updater: (prev: PaymentGatewaySummary[]) => PaymentGatewaySummary[]) => void;
}) {
  const router = useRouter();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const dialogRef = useDismissablePanel<HTMLDivElement>(confirmingDisconnect, () =>
    setConfirmingDisconnect(false),
  );

  // Without this, the page behind the dialog keeps scrolling under the
  // user's fingers/wheel while the confirm dialog sits on top of it.
  useEffect(() => {
    if (!confirmingDisconnect) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmingDisconnect]);

  async function confirmDisconnect() {
    setDisconnecting(true);
    const result = await disconnectPaymentGatewayAction(brandId, gateway.provider);
    setDisconnecting(false);
    if (result.ok) {
      setConfirmingDisconnect(false);
      onGatewaysChange((prev) =>
        prev.map((g) =>
          g.provider === gateway.provider ? { ...g, connected: false, accountLabel: null } : g,
        ),
      );
      router.push(listHref);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mt-4">
      <Link
        href={listHref}
        className="inline-flex items-center gap-2 text-xl font-bold text-ink-strong hover:opacity-80"
      >
        <ArrowLeft className="h-5 w-5 text-brand-ink" aria-hidden />
        {gateway.displayName}
      </Link>

      <div className="mt-4 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-sm text-ink-muted">Brand</p>
              <p className="mt-1 text-base font-bold text-ink-strong">{brandDisplayName}</p>
            </div>
            <div className="border-l border-border pl-8">
              <p className="text-sm text-ink-muted">Status</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-base font-bold text-success">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                Connected
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmingDisconnect(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-danger bg-danger-surface px-4 py-2.5 text-sm font-bold text-danger hover:opacity-90"
          >
            <Unlink className="h-4 w-4" aria-hidden />
            Disconnect
          </button>
        </div>

        {initialMethodSettings && (
          <PaymentMethodsSection brandId={brandId} initial={initialMethodSettings} />
        )}

        {initialTransactions && <TransactionLog brandId={brandId} initial={initialTransactions} />}
      </div>

      {confirmingDisconnect &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-gateway-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div ref={dialogRef} className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <h2 id="disconnect-gateway-title" className="text-base font-bold text-ink-strong">
                  Disconnect {gateway.displayName}?
                </h2>
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-0.5 text-ink-muted hover:text-ink-strong disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                Your branded checkout won&rsquo;t be able to process payments until you reconnect a
                gateway.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                Existing invoices and customer records are not affected.
              </p>
              <div className="mt-5 flex justify-end gap-3 border-t border-border pt-5">
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                  className="rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted disabled:opacity-60"
                >
                  Keep connected
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDisconnect()}
                  disabled={disconnecting}
                  className="rounded-[10px] bg-danger px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The same PaymentMethodSettings /settings/payment-methods reads and
 * writes, embedded here so a brand admin does not have to leave the gateway
 * they just connected to turn methods on. One source of truth either way —
 * see updatePaymentMethodSettingsAction.
 *
 * Apple Pay and Google Pay are two separate fields on the settings record,
 * but a single "Digital Wallet" row here — the payment page already shows
 * whichever of the two the customer's own device supports, so there is
 * nothing for a brand admin to choose between them for. */
function PaymentMethodsSection({
  brandId,
  initial,
}: {
  brandId: string;
  initial: PaymentMethodSettings;
}) {
  const [settings, setSettings] = useState(initial);
  const [savingField, setSavingField] = useState<
    keyof PaymentMethodSettings | 'digitalWallet' | null
  >(null);

  const save = useCallback(
    async (
      field: keyof PaymentMethodSettings | 'digitalWallet',
      patch: Partial<PaymentMethodSettings>,
    ) => {
      const previous = settings;
      const next = { ...settings, ...patch };
      setSettings(next);
      setSavingField(field);
      const result = await updatePaymentMethodSettingsAction(brandId, next);
      setSavingField(null);
      if (result.ok) {
        setSettings(result.data);
      } else {
        setSettings(previous);
        toast.error(result.error);
      }
    },
    [brandId, settings],
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h3 className="text-base font-bold text-ink-strong">Payment Methods</h3>
      <div className="mt-2">
        <Toggle
          layout="row"
          label="Credit / Debit Card"
          hint="Visa, Mastercard, Amex, and Discover — instant confirmation"
          checked={settings.cardEnabled}
          disabled={savingField === 'cardEnabled'}
          onChange={(v) => void save('cardEnabled', { cardEnabled: v })}
        />
        <Toggle
          layout="row"
          label="ACH Bank Transfer"
          hint="Pay directly from a US bank account — settles in 3–5 business days"
          checked={settings.achEnabled}
          disabled={savingField === 'achEnabled'}
          onChange={(v) => void save('achEnabled', { achEnabled: v })}
        />
        <Toggle
          layout="row"
          label="Digital Wallet"
          hint="Apple Pay or Google Pay — only shown if customer device supports it"
          checked={settings.applePayEnabled || settings.googlePayEnabled}
          disabled={savingField === 'digitalWallet'}
          onChange={(v) => void save('digitalWallet', { applePayEnabled: v, googlePayEnabled: v })}
        />
        <Toggle
          layout="row"
          divided={false}
          label="Upload Check"
          hint="Attach a photo of the check for manual review and approval"
          checked={settings.checkEnabled}
          disabled={savingField === 'checkEnabled'}
          onChange={(v) => void save('checkEnabled', { checkEnabled: v })}
        />
      </div>
    </section>
  );
}

function FilterSelect({
  icon: Icon,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="relative inline-flex items-center">
      <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted" />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 appearance-none rounded-full border border-border bg-surface py-1.5 pl-9 pr-8 text-sm font-medium text-ink-strong hover:bg-surface-muted"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-ink-muted"
        aria-hidden
      />
    </div>
  );
}

function AmountCell({
  amountMinor,
  currency,
  status,
}: {
  amountMinor: number;
  currency: string;
  status: PaymentTransaction['status'];
}) {
  const isRefund = status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED' || amountMinor < 0;
  const amount = formatMoney(Math.abs(amountMinor), currency);
  return (
    <span
      className={
        isRefund
          ? 'text-danger'
          : status === 'SETTLED'
            ? 'text-success'
            : 'font-medium text-ink-strong'
      }
    >
      {isRefund ? `-${amount}` : amount}
    </span>
  );
}

function TransactionLog({
  brandId,
  initial,
}: {
  brandId: string;
  initial: PaymentTransactionListResponse;
}) {
  const [dateRange, setDateRange] = useState<string>('30');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');

  const transactions = useMemo(() => {
    const cutoff =
      dateRange === 'all' ? null : Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000;
    return initial.data.filter((tx) => {
      if (cutoff !== null && new Date(tx.createdAt).getTime() < cutoff) return false;
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (methodFilter !== 'all' && tx.method !== methodFilter) return false;
      return true;
    });
  }, [initial.data, dateRange, statusFilter, methodFilter]);

  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    ...(Object.keys(STATUS_STYLE) as PaymentTransaction['status'][]).map((value) => ({
      value,
      label: STATUS_STYLE[value].label,
    })),
  ];
  const methodOptions = [
    { value: 'all', label: 'All payment methods' },
    ...(Object.keys(METHOD_LABEL) as PaymentTransaction['method'][]).map((value) => ({
      value,
      label: METHOD_LABEL[value],
    })),
  ];

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-base font-bold text-ink-strong">Transaction Log</h3>
          <p className="mt-1 text-sm text-ink-muted">
            This brand&rsquo;s full payment history — it stays here no matter which gateway is
            connected right now.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            icon={Calendar}
            ariaLabel="Filter by date range"
            value={dateRange}
            onChange={setDateRange}
            options={DATE_RANGE_OPTIONS}
          />
          <FilterSelect
            icon={Target}
            ariaLabel="Filter by status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusOptions}
          />
          <FilterSelect
            icon={CreditCard}
            ariaLabel="Filter by payment method"
            value={methodFilter}
            onChange={setMethodFilter}
            options={methodOptions}
          />
        </div>
      </div>

      {transactions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted sm:px-6">
          {initial.data.length === 0
            ? 'No transactions yet.'
            : 'No transactions match these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recent payment transactions</caption>
            <thead>
              <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
                <th scope="col" className="px-5 py-3 sm:px-6">
                  Transaction ID
                </th>
                <th scope="col" className="px-5 py-3">
                  Date &amp; Time
                </th>
                <th scope="col" className="px-5 py-3">
                  Amount
                </th>
                <th scope="col" className="px-5 py-3">
                  Customer
                </th>
                <th scope="col" className="px-5 py-3">
                  Invoice #
                </th>
                <th scope="col" className="px-5 py-3">
                  Payment Method
                </th>
                <th scope="col" className="px-5 py-3 sm:pr-6">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.map((tx) => {
                const status = STATUS_STYLE[tx.status];
                return (
                  <tr key={tx.id}>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-muted sm:px-6">
                      {tx.id.slice(0, 8)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      {formatDateTime(tx.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-medium">
                      <AmountCell
                        amountMinor={tx.amountMinor}
                        currency={tx.currency}
                        status={tx.status}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/customers?brandId=${brandId}&search=${encodeURIComponent(tx.customerName)}`}
                        className="font-medium text-[#2563EB] hover:underline"
                      >
                        {tx.customerName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <Link
                        href={`/invoices?brandId=${brandId}&search=${encodeURIComponent(tx.invoiceNumber)}`}
                        className="font-medium text-[#2563EB] hover:underline"
                      >
                        {tx.invoiceNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      {METHOD_LABEL[tx.method]}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 sm:pr-6">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden />
                        <span className={`font-medium ${status.text}`}>{status.label}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
