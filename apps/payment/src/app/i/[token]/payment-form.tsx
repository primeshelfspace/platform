'use client';

import { useState } from 'react';
import {
  applyBasisPoints,
  formatMinorForDisplay,
  incursCardFee,
  toCurrencyCode,
} from '@fenwick/shared/money';
import { API_URL } from '@/lib/env';
import type { PublicInvoice } from '@/lib/invoice';
import { StripeCardForm } from './stripe-card-form';
import { CreditCardIcon, FileCheckIcon, LandmarkIcon, WalletIcon } from './icons';

/** The API's PaymentMethod values this page can attempt. MANUAL is the
 * internal recording of an offline payment and is never a customer choice. */
type Method = 'CARD' | 'WALLET' | 'ACH' | 'CHECK';

/**
 * The live payment form, laid out as the admin's Payment Page editor previews
 * it (PreviewBody/MethodGrid/CardDetailsForm/PayButton in
 * apps/admin/.../brand-settings/payment-page-editor.tsx): "Choose how to pay"
 * above a two-column method grid, the chosen method's detail block below it,
 * and one full-width accent-coloured "Pay {amount}" button.
 *
 * Two things differ from that preview by necessity, both in the same
 * direction — the preview draws a mockup, this moves money:
 *
 *  - The grid lists only what this brand actually has enabled
 *    (invoice.enabledMethods). PaymentsService enforces the same list
 *    server-side regardless of what renders here (FR-PAY-005).
 *  - "Card details" is Stripe's own PaymentElement, not the plain inputs the
 *    preview draws. Card data is entered into an iframe served by Stripe and
 *    confirmed straight against Stripe from the browser; this app never sees
 *    a card number, which is what keeps PCI scope at SAQ A (TDD-001 §3.3).
 *
 * That second difference is also why the card fields appear after "Pay"
 * rather than beside the method grid the way the preview draws them. The
 * PaymentElement needs a client_secret, which only exists once an intent has
 * been created — and creating one is not free: PaymentsService.createIntent
 * runs the INITIATE_PAYMENT transition and writes a Payment row, so opening
 * the intent on selection would move every merely-opened invoice to
 * PENDING_PAYMENT and leave an abandoned attempt behind it. The intent is
 * therefore opened when the customer commits, not when they browse.
 */
export function PaymentForm({ invoice, token }: { invoice: PublicInvoice; token: string }) {
  const methods = availableMethods(invoice);
  const [selected, setSelected] = useState<Method | null>(methods[0]?.key ?? null);
  const [step, setStep] = useState<Step>({ kind: 'select' });

  const currency = toCurrencyCode(invoice.currency);
  const chosen = methods.find((m) => m.key === selected) ?? null;
  const amountLabel = formatMinorForDisplay(
    chosen?.quotedTotalMinor ?? invoice.balanceMinor,
    currency,
  );

  if (methods.length === 0) {
    return (
      <p className="rounded-lg bg-danger-surface px-4 py-6 text-center text-sm text-danger">
        This brand has no payment method enabled right now. Please contact them directly.
      </p>
    );
  }

  if (step.kind !== 'select' && step.kind !== 'card-confirm') {
    return <Outcome step={step} onRetry={() => setStep({ kind: 'select' })} />;
  }

  /** Asks the API to open an attempt for `method`. CARD comes back as
   * REQUIRES_ACTION with a client secret to confirm in the browser; the other
   * methods settle (or fail, or stay pending) server-side. */
  async function submit(method: Method) {
    setStep({ kind: 'processing' });
    try {
      const response = await fetch(`${API_URL}/public/invoices/${token}/payment-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          // Client-generated: a double click collapses to one charge
          // (TDD-001 §8.3), since the server derives its idempotency key
          // from this value.
          attemptNonce: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as {
        gatewayStatus?: string;
        declineReason?: string | null;
        clientToken?: string | null;
        message?: string;
      };
      if (!response.ok) {
        setStep({ kind: 'error', message: body.message ?? 'Something went wrong.' });
        return;
      }
      if (body.gatewayStatus === 'SUCCEEDED') setStep({ kind: 'success' });
      else if (body.gatewayStatus === 'FAILED') {
        setStep({ kind: 'failure', reason: body.declineReason ?? null });
      } else if (body.gatewayStatus === 'REQUIRES_ACTION' && body.clientToken) {
        setStep({ kind: 'card-confirm', clientSecret: body.clientToken });
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
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                isSelected
                  ? 'border-2 text-ink-strong'
                  : 'border-[#E5E7EB] text-ink-muted hover:border-[#D1D5DB]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      {step.kind === 'card-confirm' ? (
        <StripeCardForm
          publishableKey={invoice.stripePublishableKey}
          stripeAccount={invoice.stripeAccountId}
          clientSecret={step.clientSecret}
          accentColor={invoice.accentColor}
          amountLabel={amountLabel}
          returnUrl={typeof window !== 'undefined' ? window.location.href : ''}
          onSucceeded={() => setStep({ kind: 'success' })}
          onFailed={(reason) => setStep({ kind: 'failure', reason })}
          onCancel={() => setStep({ kind: 'select' })}
        />
      ) : (
        <>
          {chosen && chosen.key !== 'CARD' && (
            <p className="mt-5 rounded-lg border border-dashed border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
              You will be redirected to complete payment via {chosen.label}.
            </p>
          )}
          <button
            type="button"
            disabled={!chosen}
            onClick={() => chosen && submit(chosen.key)}
            style={{ backgroundColor: invoice.accentColor }}
            className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Pay {amountLabel}
          </button>
          {chosen?.key === 'CARD' && (
            <p className="mt-2 text-center text-xs text-ink-subtle">
              Card details are entered on the next step, in Stripe&rsquo;s secure form.
            </p>
          )}
        </>
      )}
    </div>
  );
}

type Step =
  | { kind: 'select' }
  | { kind: 'processing' }
  | { kind: 'card-confirm'; clientSecret: string }
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
