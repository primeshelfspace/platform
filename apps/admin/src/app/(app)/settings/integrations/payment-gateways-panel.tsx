'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Link2, Loader2, Unlink } from 'lucide-react';
import type {
  PaymentGatewayProvider,
  PaymentGatewaySummary,
  PaymentMethodSettings,
  PaymentTransaction,
  PaymentTransactionListResponse,
} from '@/lib/api';
import { Toggle } from '@/components/ui/toggle';
import { useDismissablePanel } from '@/hooks/use-dismissable-panel';
import {
  connectPaymentGatewayAction,
  disconnectPaymentGatewayAction,
  updatePaymentMethodSettingsAction,
} from './actions';

/** Colours are each gateway's own brand colour — same "coloured square +
 * initial" convention IntegrationsPanel already uses for Zoho's "Z". */
const GATEWAY_STYLE: Record<PaymentGatewayProvider, { badge: string; bg: string }> = {
  STRIPE: { badge: 'S', bg: '#635BFF' },
  PAYPAL: { badge: 'P', bg: '#003087' },
  SQUARE: { badge: 'Sq', bg: '#1A1A1A' },
  AUTHORIZE_NET: { badge: 'A', bg: '#EF7622' },
};

const GATEWAY_DESCRIPTION: Record<PaymentGatewayProvider, string> = {
  STRIPE: 'Accept credit cards, ACH and digital wallets through Stripe Connect.',
  PAYPAL: 'Let customers pay with their PayPal balance, card or bank account.',
  SQUARE: 'Process card payments through a Square merchant account.',
  AUTHORIZE_NET: 'Route card and eCheck payments through Authorize.net.',
};

const METHOD_LABEL: Record<PaymentTransaction['method'], string> = {
  CARD: 'Credit/Debit Card',
  WALLET: 'Digital Wallet',
  ACH: 'ACH Bank Transfer',
  CHECK: 'Manual Check',
  MANUAL: 'Manual',
};

const STATUS_STYLE: Record<
  PaymentTransaction['status'],
  { dot: string; text: string; label: string }
> = {
  SETTLED: { dot: 'bg-success', text: 'text-success', label: 'Success' },
  REFUNDED: { dot: 'bg-success', text: 'text-success', label: 'Refunded' },
  PARTIALLY_REFUNDED: { dot: 'bg-warning', text: 'text-warning', label: 'Partially refunded' },
  PROCESSING: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Processing' },
  INITIATED: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Pending' },
  FAILED: { dot: 'bg-danger', text: 'text-danger', label: 'Failed' },
  CANCELLED: { dot: 'bg-ink-subtle', text: 'text-ink-muted', label: 'Cancelled' },
};

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

function GatewayBadge({ provider }: { provider: PaymentGatewayProvider }) {
  const style = GATEWAY_STYLE[provider];
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
      style={{ backgroundColor: style.bg }}
      aria-hidden
    >
      {style.badge}
    </span>
  );
}

/**
 * Brand Settings → Payment Gateways. A list of the four gateways this
 * platform can offer, and — once one is connected — a detail view for it:
 * its own Payment Methods toggles, a Disconnect confirmation, and the
 * brand's full Transaction Log underneath.
 *
 * The log is deliberately the same table regardless of which gateway's
 * detail is open (see PaymentsService.list on the API side) — connecting a
 * new gateway does not make the previous one's transaction history
 * disappear, because nothing here is actually scoped to "the currently
 * connected gateway" in the first place.
 */
export function PaymentGatewaysPanel({
  brandId,
  brandDisplayName,
  stripeConnectUrl,
  initialGateways,
  selected,
  initialMethodSettings,
  initialTransactions,
}: {
  brandId: string;
  brandDisplayName: string;
  stripeConnectUrl: string;
  initialGateways: PaymentGatewaySummary[];
  selected: PaymentGatewayProvider | null;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
}) {
  const [gateways, setGateways] = useState(initialGateways);
  const listHref = `/settings/integrations?tab=payments&brandId=${brandId}`;

  const selectedGateway = selected ? gateways.find((g) => g.provider === selected) : null;

  if (!selected || !selectedGateway) {
    return (
      <GatewayList
        brandId={brandId}
        listHref={listHref}
        gateways={gateways}
        stripeConnectUrl={stripeConnectUrl}
        onConnected={(provider) =>
          setGateways((prev) =>
            prev.map((g) => (g.provider === provider ? { ...g, connected: true } : g)),
          )
        }
      />
    );
  }

  return (
    <GatewayDetail
      brandId={brandId}
      brandDisplayName={brandDisplayName}
      listHref={listHref}
      gateway={selectedGateway}
      otherGateways={gateways.filter((g) => g.provider !== selectedGateway.provider)}
      stripeConnectUrl={stripeConnectUrl}
      initialMethodSettings={initialMethodSettings}
      initialTransactions={initialTransactions}
      onGatewaysChange={setGateways}
    />
  );
}

function GatewayList({
  brandId,
  listHref,
  gateways,
  stripeConnectUrl,
  onConnected,
}: {
  brandId: string;
  listHref: string;
  gateways: PaymentGatewaySummary[];
  stripeConnectUrl: string;
  onConnected: (provider: PaymentGatewayProvider) => void;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState<PaymentGatewayProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(provider: Exclude<PaymentGatewayProvider, 'STRIPE'>) {
    setConnecting(provider);
    setError(null);
    const result = await connectPaymentGatewayAction(brandId, provider);
    setConnecting(null);
    if (result.ok) {
      onConnected(provider);
      router.push(`${listHref}&gateway=${provider.toLowerCase()}`);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {error && <div className="rounded-md bg-danger-surface p-3 text-sm text-danger">{error}</div>}
      {gateways.map((gateway) => (
        <div
          key={gateway.provider}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-center gap-4">
            <GatewayBadge provider={gateway.provider} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-ink-strong">{gateway.displayName}</p>
                {gateway.connected && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                    Connected
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">
                {gateway.connected && gateway.accountLabel
                  ? gateway.accountLabel
                  : GATEWAY_DESCRIPTION[gateway.provider]}
              </p>
            </div>
          </div>

          {gateway.connected ? (
            <Link
              href={`${listHref}&gateway=${gateway.provider.toLowerCase()}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted"
            >
              View Details
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : gateway.provider === 'STRIPE' ? (
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
              onClick={() =>
                void connect(gateway.provider as Exclude<PaymentGatewayProvider, 'STRIPE'>)
              }
              disabled={connecting === gateway.provider}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
            >
              {connecting === gateway.provider ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden />
              )}
              {connecting === gateway.provider ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function GatewayDetail({
  brandId,
  brandDisplayName,
  listHref,
  gateway,
  otherGateways,
  stripeConnectUrl,
  initialMethodSettings,
  initialTransactions,
  onGatewaysChange,
}: {
  brandId: string;
  brandDisplayName: string;
  listHref: string;
  gateway: PaymentGatewaySummary;
  otherGateways: PaymentGatewaySummary[];
  stripeConnectUrl: string;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
  onGatewaysChange: (updater: (prev: PaymentGatewaySummary[]) => PaymentGatewaySummary[]) => void;
}) {
  const router = useRouter();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connectingOther, setConnectingOther] = useState<PaymentGatewayProvider | null>(null);

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
    setDisconnectError(null);
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
      setDisconnectError(result.error);
    }
  }

  async function connectOther(provider: Exclude<PaymentGatewayProvider, 'STRIPE'>) {
    setConnectingOther(provider);
    const result = await connectPaymentGatewayAction(brandId, provider);
    setConnectingOther(null);
    if (result.ok) {
      onGatewaysChange((prev) =>
        prev.map((g) => (g.provider === provider ? { ...g, connected: true } : g)),
      );
      router.push(`${listHref}&gateway=${provider.toLowerCase()}`);
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
              <p className="text-sm text-ink-muted">Account</p>
              <p className="mt-1 text-base font-bold text-ink-strong">
                {gateway.accountLabel ?? brandDisplayName}
              </p>
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

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <h3 className="text-base font-bold text-ink-strong">Available</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Connect another gateway without leaving this brand&rsquo;s Payment Gateways.
          </p>
          <div className="mt-4 space-y-3">
            {otherGateways.map((other) => (
              <div
                key={other.provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <GatewayBadge provider={other.provider} />
                  <div>
                    <p className="text-sm font-bold text-ink-strong">{other.displayName}</p>
                    <p className="text-xs text-ink-muted">{GATEWAY_DESCRIPTION[other.provider]}</p>
                  </div>
                </div>
                {other.connected ? (
                  <Link
                    href={`${listHref}&gateway=${other.provider.toLowerCase()}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink-strong hover:bg-surface-muted"
                  >
                    View Details
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : other.provider === 'STRIPE' ? (
                  <a
                    href={stripeConnectUrl}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-ink-strong px-3 py-1.5 text-xs font-bold text-white hover:bg-black"
                  >
                    Connect
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void connectOther(other.provider as Exclude<PaymentGatewayProvider, 'STRIPE'>)
                    }
                    disabled={connectingOther === other.provider}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-ink-strong px-3 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-60"
                  >
                    {connectingOther === other.provider ? 'Connecting…' : 'Connect'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {initialTransactions && <TransactionLog initial={initialTransactions} />}
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
              <h2 id="disconnect-gateway-title" className="text-base font-bold text-ink-strong">
                Disconnect {gateway.displayName}?
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                {brandDisplayName} will stop accepting payments through {gateway.displayName}{' '}
                immediately, and any recurring payments through it will be affected. Its
                transaction history stays right where it is, and you can reconnect at any time.
              </p>
              {disconnectError && (
                <div className="mt-3 rounded-md bg-danger-surface p-3 text-sm text-danger">
                  {disconnectError}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                  className="rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted disabled:opacity-60"
                >
                  Cancel
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
 * see updatePaymentMethodSettingsAction. */
function PaymentMethodsSection({
  brandId,
  initial,
}: {
  brandId: string;
  initial: PaymentMethodSettings;
}) {
  const [settings, setSettings] = useState(initial);
  const [savingField, setSavingField] = useState<keyof PaymentMethodSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (field: keyof PaymentMethodSettings, checked: boolean) => {
      const previous = settings;
      const next = { ...settings, [field]: checked };
      setSettings(next);
      setSavingField(field);
      setError(null);
      const result = await updatePaymentMethodSettingsAction(brandId, next);
      setSavingField(null);
      if (result.ok) {
        setSettings(result.data);
      } else {
        setSettings(previous);
        setError(result.error);
      }
    },
    [brandId, settings],
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h3 className="text-base font-bold text-ink-strong">Payment Methods</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Which methods this brand&rsquo;s payment page offers customers.
      </p>
      {error && (
        <div className="mt-3 rounded-md bg-danger-surface p-3 text-sm text-danger">{error}</div>
      )}
      <div className="mt-2">
        <Toggle
          layout="row"
          label="Credit/Debit Card"
          checked={settings.cardEnabled}
          disabled={savingField === 'cardEnabled'}
          onChange={(v) => void save('cardEnabled', v)}
        />
        <Toggle
          layout="row"
          label="ACH Bank Transfer"
          checked={settings.achEnabled}
          disabled={savingField === 'achEnabled'}
          onChange={(v) => void save('achEnabled', v)}
        />
        <Toggle
          layout="row"
          label="Apple Pay"
          checked={settings.applePayEnabled}
          disabled={savingField === 'applePayEnabled'}
          onChange={(v) => void save('applePayEnabled', v)}
        />
        <Toggle
          layout="row"
          label="Google Pay"
          checked={settings.googlePayEnabled}
          disabled={savingField === 'googlePayEnabled'}
          onChange={(v) => void save('googlePayEnabled', v)}
        />
        <Toggle
          layout="row"
          divided={false}
          label="Manual Check Upload"
          checked={settings.checkEnabled}
          disabled={savingField === 'checkEnabled'}
          onChange={(v) => void save('checkEnabled', v)}
        />
      </div>
    </section>
  );
}

function TransactionLog({ initial }: { initial: PaymentTransactionListResponse }) {
  const [transactions] = useState(initial.data);

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <h3 className="text-base font-bold text-ink-strong">Transaction Log</h3>
        <p className="mt-1 text-sm text-ink-muted">
          This brand&rsquo;s full payment history — it stays here no matter which gateway is
          connected right now.
        </p>
      </div>

      {transactions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted sm:px-6">No transactions yet.</p>
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
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-ink-strong">
                      {formatMoney(tx.amountMinor, tx.currency)}
                    </td>
                    <td className="px-5 py-3 text-ink-strong">{tx.customerName}</td>
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
