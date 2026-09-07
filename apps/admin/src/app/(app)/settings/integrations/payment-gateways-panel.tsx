'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Link2, Loader2, Unlink } from 'lucide-react';
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
import {
  connectAuthorizeNetAction,
  connectPaymentGatewayAction,
  disconnectPaymentGatewayAction,
  updatePaymentMethodSettingsAction,
} from './actions';

/** Providers that link straight to their own OAuth consent screen rather
 * than calling connectPaymentGatewayAction. */
type OAuthProvider = Extract<PaymentGatewayProvider, 'STRIPE' | 'SQUARE'>;
function isOAuthProvider(provider: PaymentGatewayProvider): provider is OAuthProvider {
  return provider === 'STRIPE' || provider === 'SQUARE';
}

const GATEWAY_DESCRIPTION: Record<PaymentGatewayProvider, string> = {
  STRIPE: 'Card, ACH, Apple Pay & Google Pay — payouts land straight in your Stripe account',
  PAYPAL: 'Accept PayPal and major cards through your own PayPal Business account',
  SQUARE: 'Card payments processed through your existing Square account',
  AUTHORIZE_NET: 'Card and eCheck payments through your Authorize.net merchant account',
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
  basePath,
  stripeConnectUrl,
  squareConnectUrl,
  initialGateways,
  selected,
  initialMethodSettings,
  initialTransactions,
}: {
  brandId: string;
  brandDisplayName: string;
  /** Where this panel's own list/detail links point — the page embedding it
   * owns the tab query param(s) that get this panel rendered in the first
   * place, so the panel itself doesn't hardcode which page that is. */
  basePath: string;
  stripeConnectUrl: string;
  squareConnectUrl: string;
  initialGateways: PaymentGatewaySummary[];
  selected: PaymentGatewayProvider | null;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
}) {
  const router = useRouter();
  const [gateways, setGateways] = useState(initialGateways);
  const [authorizeNetModalOpen, setAuthorizeNetModalOpen] = useState(false);
  const listHref = `${basePath}&brandId=${brandId}`;

  const connectUrls: Record<OAuthProvider, string> = {
    STRIPE: stripeConnectUrl,
    SQUARE: squareConnectUrl,
  };

  function onAuthorizeNetConnected() {
    setAuthorizeNetModalOpen(false);
    setGateways((prev) =>
      prev.map((g) => (g.provider === 'AUTHORIZE_NET' ? { ...g, connected: true } : g)),
    );
    router.push(`${listHref}&gateway=authorize_net`);
  }

  const selectedGateway = selected ? gateways.find((g) => g.provider === selected) : null;

  return (
    <>
      {!selected || !selectedGateway ? (
        <GatewayList
          brandId={brandId}
          listHref={listHref}
          gateways={gateways}
          connectUrls={connectUrls}
          onConnected={(provider) =>
            setGateways((prev) =>
              prev.map((g) => (g.provider === provider ? { ...g, connected: true } : g)),
            )
          }
          onConnectAuthorizeNet={() => setAuthorizeNetModalOpen(true)}
        />
      ) : (
        <GatewayDetail
          brandId={brandId}
          brandDisplayName={brandDisplayName}
          listHref={listHref}
          gateway={selectedGateway}
          otherGateways={gateways.filter((g) => g.provider !== selectedGateway.provider)}
          connectUrls={connectUrls}
          initialMethodSettings={initialMethodSettings}
          initialTransactions={initialTransactions}
          onGatewaysChange={setGateways}
          onConnectAuthorizeNet={() => setAuthorizeNetModalOpen(true)}
        />
      )}
      {authorizeNetModalOpen && (
        <AuthorizeNetConnectModal
          brandId={brandId}
          onClose={() => setAuthorizeNetModalOpen(false)}
          onConnected={onAuthorizeNetConnected}
        />
      )}
    </>
  );
}

function GatewayList({
  brandId,
  listHref,
  gateways,
  connectUrls,
  onConnected,
  onConnectAuthorizeNet,
}: {
  brandId: string;
  listHref: string;
  gateways: PaymentGatewaySummary[];
  connectUrls: Record<OAuthProvider, string>;
  onConnected: (provider: PaymentGatewayProvider) => void;
  onConnectAuthorizeNet: () => void;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState<PaymentGatewayProvider | null>(null);

  async function connect(provider: Extract<PaymentGatewayProvider, 'PAYPAL'>) {
    setConnecting(provider);
    const result = await connectPaymentGatewayAction(brandId, provider);
    setConnecting(null);
    if (result.ok) {
      onConnected(provider);
      router.push(`${listHref}&gateway=${provider.toLowerCase()}`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {gateways.map((gateway) => (
        <div
          key={gateway.provider}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-center gap-4">
            <GatewayMark provider={gateway.provider} />
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
          ) : isOAuthProvider(gateway.provider) ? (
            <a
              href={connectUrls[gateway.provider]}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2 text-sm font-bold text-white hover:bg-black"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Connect
            </a>
          ) : gateway.provider === 'AUTHORIZE_NET' ? (
            <button
              type="button"
              onClick={onConnectAuthorizeNet}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2 text-sm font-bold text-white hover:bg-black"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Connect
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                void connect(gateway.provider as Extract<PaymentGatewayProvider, 'PAYPAL'>)
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
  connectUrls,
  initialMethodSettings,
  initialTransactions,
  onGatewaysChange,
  onConnectAuthorizeNet,
}: {
  brandId: string;
  brandDisplayName: string;
  listHref: string;
  gateway: PaymentGatewaySummary;
  otherGateways: PaymentGatewaySummary[];
  connectUrls: Record<OAuthProvider, string>;
  initialMethodSettings: PaymentMethodSettings | null;
  initialTransactions: PaymentTransactionListResponse | null;
  onGatewaysChange: (updater: (prev: PaymentGatewaySummary[]) => PaymentGatewaySummary[]) => void;
  onConnectAuthorizeNet: () => void;
}) {
  const router = useRouter();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
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

  async function connectOther(provider: Extract<PaymentGatewayProvider, 'PAYPAL'>) {
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
                  <GatewayMark provider={other.provider} />
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
                ) : isOAuthProvider(other.provider) ? (
                  <a
                    href={connectUrls[other.provider]}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-ink-strong px-3 py-1.5 text-xs font-bold text-white hover:bg-black"
                  >
                    Connect
                  </a>
                ) : other.provider === 'AUTHORIZE_NET' ? (
                  <button
                    type="button"
                    onClick={onConnectAuthorizeNet}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-ink-strong px-3 py-1.5 text-xs font-bold text-white hover:bg-black"
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void connectOther(other.provider as Extract<PaymentGatewayProvider, 'PAYPAL'>)
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
                immediately, and any recurring payments through it will be affected. Its transaction
                history stays right where it is, and you can reconnect at any time.
              </p>
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

/**
 * Authorize.net has no consent screen to redirect to, so "Connect" opens
 * this instead: the brand's own API Login ID and Transaction Key, verified
 * against Authorize.net (AuthorizeNetAccountService.connect) before anything
 * is stored — a wrong pair is refused right here with the provider's own
 * message, not discovered later at the first payment attempt.
 */
function AuthorizeNetConnectModal({
  brandId,
  onClose,
  onConnected,
}: {
  brandId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [apiLoginId, setApiLoginId] = useState('');
  const [transactionKey, setTransactionKey] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useDismissablePanel<HTMLFormElement>(true, onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const result = await connectAuthorizeNetAction(brandId, {
      apiLoginId: apiLoginId.trim(),
      transactionKey: transactionKey.trim(),
      environment,
    });
    setSubmitting(false);
    if (result.ok) {
      onConnected();
    } else {
      toast.error(result.error);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="authorize-net-connect-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <form
        ref={dialogRef}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-lg"
      >
        <h2 id="authorize-net-connect-title" className="text-base font-bold text-ink-strong">
          Connect Authorize.net
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          From your Authorize.net Merchant Interface: Account &rarr; Settings &rarr; Security
          Settings &rarr; API Credentials &amp; Keys.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-ink-strong">API Login ID</span>
            <input
              type="text"
              required
              autoFocus
              value={apiLoginId}
              onChange={(e) => setApiLoginId(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink-strong"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-strong">Transaction Key</span>
            <input
              type="password"
              required
              value={transactionKey}
              onChange={(e) => setTransactionKey(e.target.value)}
              className="mt-1 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink-strong"
            />
          </label>
          <fieldset className="flex gap-4">
            <legend className="text-sm font-medium text-ink-strong">Environment</legend>
            {(['sandbox', 'production'] as const).map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm text-ink-strong">
                <input
                  type="radio"
                  name="environment"
                  value={option}
                  checked={environment === option}
                  onChange={() => setEnvironment(option)}
                />
                {option === 'sandbox' ? 'Sandbox' : 'Production'}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[10px] border border-border bg-surface px-4 py-2 text-sm font-bold text-ink-strong hover:bg-surface-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-[10px] bg-ink-strong px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
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

  const save = useCallback(
    async (field: keyof PaymentMethodSettings, checked: boolean) => {
      const previous = settings;
      const next = { ...settings, [field]: checked };
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
      <p className="mt-1 text-sm text-ink-muted">
        Which methods this brand&rsquo;s payment page offers customers.
      </p>
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
