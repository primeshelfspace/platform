'use client';

import { useEffect, useState } from 'react';
import {
  applyBasisPoints,
  formatMinorForDisplay,
  incursCardFee,
  toCurrencyCode,
} from '@fenwick/shared/money';
import { API_URL } from '@/lib/env';
import type { PublicInvoice } from '@/lib/invoice';
import { useAmountDue } from './amount-due-context';
import { StripeCardForm, type CreateIntentResult } from './stripe-card-form';
import { CreditCardIcon, FileCheckIcon, LandmarkIcon, WalletIcon } from './icons';

/** The API's PaymentMethod values this page can attempt. MANUAL is the
 * internal recording of an offline payment and is never a customer choice. */
type Method = 'CARD' | 'WALLET' | 'ACH' | 'CHECK';

/**
 * crypto.randomUUID() is Web Crypto's convenience method, and per spec it —
 * unlike getRandomValues() — only exists in a secure context (HTTPS, or
 * localhost). This page is reachable over plain HTTP (PAYMENT_PUBLIC_URL has
 * no TLS in front of it yet), where `crypto.randomUUID` is simply undefined,
 * so calling it throws "crypto.randomUUID is not a function" the moment a
 * customer hits Pay. getRandomValues has no such restriction, so build the
 * same v4 UUID shape from that instead of depending on the convenience method.
 */
function randomNonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The live payment form, laid out as the admin's Payment Page editor previews
 * it (PreviewBody/MethodGrid/CardDetailsForm/PayButton in
 * apps/admin/.../brand-settings/payment-page-editor.tsx): "Choose how to pay"
 * above a two-column method grid, the chosen method's detail block below it,
 * and one full-width accent-coloured "Pay {amount}" button.
 *
 * One thing differs from that preview by necessity: the grid lists only what
 * this brand actually has enabled (invoice.enabledMethods). PaymentsService
 * enforces the same list server-side regardless of what renders here
 * (FR-PAY-005).
 *
 * "Card details" itself is styled to look exactly like the preview's plain
 * inputs, but each field (card number, expiry, CVC) is really a separate
 * Stripe Element — StripeCardForm mounts CardNumberElement/CardExpiryElement/
 * CardCvcElement inside identically-styled wrapper boxes rather than the
 * single stock PaymentElement, precisely so this can be styled pixel-for-
 * pixel to the branding preview while every keystroke still lands in an
 * iframe Stripe serves; this app never sees a card number, which is what
 * keeps PCI scope at SAQ A (TDD-001 §3.3).
 *
 * The card fields mount immediately under the method grid the moment Card is
 * selected, matching the preview — StripeCardForm uses Stripe's deferred-
 * intent pattern (no client_secret until submit) to make that safe:
 * PaymentsService.createIntent still only runs once the customer actually
 * submits that form, not the moment they select the tile, so opening the
 * real intent (INITIATE_PAYMENT, a Payment row) never happens just because
 * someone was browsing options. ACH/Wallet/Check have no such split-second
 * confirmation step, so they still go through the single outer "Pay" button
 * below the grid.
 */
export function PaymentForm({
  invoice,
  token,
  preferredMethod,
}: {
  invoice: PublicInvoice;
  token: string;
  /** From ?method= on the emailed link (InvoicesService.sendEmail). Only
   * honoured when this brand actually offers that method — a link built
   * before a brand disabled it, or one somebody hand-edited, must not
   * preselect something that was never really available. */
  preferredMethod?: string;
}) {
  const methods = availableMethods(invoice);
  const preselected = methods.find((m) => m.key === preferredMethod)?.key;
  const [selected, setSelected] = useState<Method | null>(preselected ?? methods[0]?.key ?? null);
  const [step, setStep] = useState<Step>({ kind: 'select' });

  const currency = toCurrencyCode(invoice.currency);
  const chosen = methods.find((m) => m.key === selected) ?? null;
  const dueMinor = chosen?.quotedTotalMinor ?? invoice.balanceMinor;
  const amountLabel = formatMinorForDisplay(dueMinor, currency);

  // Keeps PaymentPageShell's headline amount matching this button exactly —
  // a method that carries a card fee quotes more than the invoice's plain
  // balance, and the summary above must reflect whatever is actually about
  // to be charged, not the invoice's face value.
  const setAmountMinor = useAmountDue()?.setAmountMinor;
  useEffect(() => {
    setAmountMinor?.(dueMinor);
  }, [setAmountMinor, dueMinor]);

  if (methods.length === 0) {
    return (
      <p className="rounded-lg bg-danger-surface px-4 py-6 text-center text-sm text-danger">
        This brand has no payment method enabled right now. Please contact them directly.
      </p>
    );
  }

  if (step.kind !== 'select') {
    return <Outcome step={step} onRetry={() => setStep({ kind: 'select' })} />;
  }

  /**
   * Tells the API what the gateway itself just told the browser, so this
   * invoice does not sit unsettled waiting on a webhook this deployment may
   * not have a reachable HTTPS endpoint for yet. Best-effort: the server
   * re-verifies with the gateway before changing anything, so a failure here
   * just leaves the eventual webhook (or the next page load) to catch it up
   * instead — the customer already has the gateway's own confirmation on
   * screen either way.
   */
  async function reconcile(clientSecret: string) {
    const gatewayReference = clientSecret.split('_secret_')[0];
    if (!gatewayReference) return;
    try {
      await fetch(`${API_URL}/public/invoices/${token}/payment-intents/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gatewayReference }),
      });
    } catch {
      // See comment above — non-fatal.
    }
  }

  /** The one place either flow actually calls the API to open an attempt.
   * CARD comes back as REQUIRES_ACTION with a client secret StripeCardForm
   * confirms in the browser; the other methods settle (or fail, or stay
   * pending) server-side, with nothing left for the client to do. */
  async function createIntent(method: Method): Promise<CreateIntentResult> {
    const response = await fetch(`${API_URL}/public/invoices/${token}/payment-intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        // Client-generated: a double click collapses to one charge
        // (TDD-001 §8.3), since the server derives its idempotency key
        // from this value.
        attemptNonce: randomNonce(),
      }),
    });
    const body = (await response.json()) as CreateIntentResult;
    if (!response.ok) throw new Error(body.message ?? 'Something went wrong.');
    return body;
  }

  /** Backs the outer "Pay" button — every method except CARD, which mounts
   * StripeCardForm instead and drives createIntent from inside its own
   * submit handler. */
  async function submitNonCard(method: Method) {
    setStep({ kind: 'processing' });
    try {
      const body = await createIntent(method);
      if (body.gatewayStatus === 'SUCCEEDED') setStep({ kind: 'success' });
      else if (body.gatewayStatus === 'FAILED') {
        setStep({ kind: 'failure', reason: body.declineReason ?? null });
      } else setStep({ kind: 'pending' });
    } catch (error) {
      setStep({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The network request failed.',
      });
    }
  }

  return (
    <div>
      <p className="text-sm font-bold text-ink-strong">Choose how to pay</p>
      <div className="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Payment method">
        {methods.map((option) => {
          const isSelected = option.key === selected;
          const Icon = option.icon;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // Changing method invalidates any secret already fetched for the
              // previous one — that PaymentIntent is for a different amount.
              onClick={() => {
                setSelected(option.key);
                setStep({ kind: 'select' });
              }}
              style={isSelected ? { borderColor: invoice.accentColor } : undefined}
              className={`flex h-[42px] items-center gap-[10px] rounded-md border-2 px-4 py-3 text-left text-sm font-medium transition-colors ${
                isSelected
                  ? 'text-ink-strong'
                  : 'border-[#E5E7EB] text-ink-muted hover:border-[#D1D5DB]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      {chosen?.key === 'CARD' ? (
        <StripeCardForm
          publishableKey={invoice.stripePublishableKey}
          stripeAccount={invoice.stripeAccountId}
          accentColor={invoice.accentColor}
          amountLabel={amountLabel}
          returnUrl={typeof window !== 'undefined' ? window.location.href : ''}
          onCreateIntent={() => createIntent('CARD')}
          onSucceeded={(clientSecret) => {
            if (clientSecret) void reconcile(clientSecret);
            setStep({ kind: 'success' });
          }}
          onFailed={(clientSecret, reason) => {
            if (clientSecret) void reconcile(clientSecret);
            setStep({ kind: 'failure', reason });
          }}
          onPending={() => setStep({ kind: 'pending' })}
          onError={(message) => setStep({ kind: 'error', message })}
        />
      ) : (
        <>
          {chosen && (
            <p className="mt-5 rounded-lg border border-dashed border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
              You will be redirected to complete payment via {chosen.label}.
            </p>
          )}
          <button
            type="button"
            disabled={!chosen}
            onClick={() => chosen && submitNonCard(chosen.key)}
            style={{ backgroundColor: invoice.accentColor }}
            className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Pay {amountLabel}
          </button>
        </>
      )}
    </div>
  );
}

type Step =
  | { kind: 'select' }
  | { kind: 'processing' }
  | { kind: 'success' }
  | { kind: 'pending' }
  | { kind: 'failure'; reason: string | null }
  | { kind: 'error'; message: string };

/** Every step that replaces the form outright. Kept in one component so the
 * result of an attempt always occupies the same block the form did. */
function Outcome({ step, onRetry }: { step: Step; onRetry: () => void }) {
  if (step.kind === 'processing') {
    return (
      <p className="rounded-lg border border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm font-medium text-ink-strong">
        Processing your payment…
      </p>
    );
  }

  if (step.kind === 'success') {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center">
        <p className="text-sm font-bold text-success">Payment successful</p>
        <p className="mt-1 text-xs text-ink-muted">A receipt has been sent to you.</p>
      </div>
    );
  }

  if (step.kind === 'pending') {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center">
        <p className="text-sm font-bold text-ink-strong">Payment pending</p>
        <p className="mt-1 text-xs text-ink-muted">
          Your bank transfer is being verified. This usually takes 1–2 business days.
        </p>
      </div>
    );
  }

  if (step.kind === 'failure') {
    return (
      <div className="rounded-lg border border-[#E5E7EB] px-4 py-6 text-center">
        <p className="text-sm font-bold text-danger">Payment couldn&rsquo;t be processed</p>
        {step.reason && <p className="mt-1 text-xs text-ink-muted">{step.reason}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-ink-strong hover:bg-surface-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  if (step.kind === 'error') {
    return (
      <div className="rounded-lg border border-[#E5E7EB] px-4 py-6 text-center">
        <p className="text-sm font-bold text-danger">We couldn&rsquo;t reach the payment service</p>
        <p className="mt-1 text-xs text-ink-muted">{step.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-ink-strong hover:bg-surface-muted"
        >
          Back
        </button>
      </div>
    );
  }

  return null;
}

interface MethodOption {
  readonly key: Method;
  readonly label: string;
  readonly icon: typeof CreditCardIcon;
  readonly quotedTotalMinor: number;
}

/**
 * CARD and WALLET carry the card fee (TDD-001 §9.2); ACH and CHECK never do.
 *
 * The fee goes through applyBasisPoints — the same primitive CalculationService
 * uses server-side — rather than a local `Math.round(preFee * rate / 10_000)`.
 * That float form rounds half toward +Infinity on a value that has already lost
 * precision to IEEE-754, where applyBasisPoints multiplies in BigInt and rounds
 * half away from zero. The two disagree by a minor unit on exact halves, which
 * is the amount the customer is about to be charged: PaymentsService quotes
 * this attempt independently, so a mismatch here shows one figure on the button
 * and charges another (NFR-INT-001).
 */
function quotedTotalFor(invoice: PublicInvoice, method: Method): number {
  if (!incursCardFee(method)) return invoice.balanceMinor;
  const preFee = invoice.subtotalMinor + invoice.taxMinor;
  return preFee + applyBasisPoints(preFee, invoice.cardFeeRateBp);
}

/**
 * The grid's four tiles, in the admin preview's own order, filtered to what
 * this brand has enabled. Apple Pay and Google Pay are two toggles but one
 * PaymentMethod at the domain level, so either one on yields the single
 * "Digital Wallet" tile.
 */
function availableMethods(invoice: PublicInvoice): MethodOption[] {
  const enabled = invoice.enabledMethods;
  const candidates: readonly (MethodOption & { readonly on: boolean })[] = [
    {
      key: 'CARD',
      label: 'Credit / Debit Card',
      icon: CreditCardIcon,
      quotedTotalMinor: quotedTotalFor(invoice, 'CARD'),
      on: enabled.card,
    },
    {
      key: 'ACH',
      label: 'ACH Bank Transfer',
      icon: LandmarkIcon,
      quotedTotalMinor: quotedTotalFor(invoice, 'ACH'),
      on: enabled.ach,
    },
    {
      key: 'WALLET',
      label: 'Digital Wallet',
      icon: WalletIcon,
      quotedTotalMinor: quotedTotalFor(invoice, 'WALLET'),
      on: enabled.applePay || enabled.googlePay,
    },
    {
      key: 'CHECK',
      label: 'Upload Check',
      icon: FileCheckIcon,
      quotedTotalMinor: quotedTotalFor(invoice, 'CHECK'),
      on: enabled.check,
    },
  ];
  return candidates.filter((c) => c.on).map(({ on: _on, ...option }) => option);
}
