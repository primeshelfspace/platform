'use client';

import { useState } from 'react';
import { applyBasisPoints, formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import type { PublicInvoice } from '@/lib/invoice';
import { StripeCardForm } from './stripe-card-form';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

type Method = 'CARD' | 'WALLET' | 'ACH';

type Step =
  | { kind: 'select' }
  | { kind: 'processing' }
  | { kind: 'card-confirm'; clientSecret: string }
  | { kind: 'success' }
  | { kind: 'pending' }
  | { kind: 'failure'; reason: string | null }
  | { kind: 'error'; message: string };

/**
 * FR-PAY-005: the method list is built from what this brand actually has
 * enabled (invoice.enabledMethods), not hardcoded — PaymentsService enforces
 * the same list server-side regardless of what renders here.
 *
 * Apple Pay and Google Pay both call the API as WALLET (one PaymentMethod
 * value covers both at the domain level). CARD now goes through a real
 * Stripe PaymentIntent; a WALLET button still resolves through the same
 * card-fee-bearing Stripe flow, but an actual Apple Pay / Google Pay sheet
 * needs domain verification with Apple and a registered Google Pay merchant
 * ID, neither of which exist yet.
 */
/**
 * CARD and WALLET carry the card fee (TDD-001 §9.2); ACH never does.
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
  if (method === 'ACH') return invoice.balanceMinor;
  const preFee = invoice.subtotalMinor + invoice.taxMinor;
  return preFee + applyBasisPoints(preFee, invoice.cardFeeRateBp);
}

interface MethodOption {
  /** Unique per button — several options can submit the same apiMethod
   * (Credit/debit card and Stripe both mean CARD), so this can't double as
   * the React list key the way apiMethod alone used to. */
  readonly id: string;
  readonly apiMethod: Method;
  readonly label: string;
  readonly quotedTotalMinor: number;
}

function availableMethods(invoice: PublicInvoice): MethodOption[] {
  const methods: MethodOption[] = [];
  if (invoice.enabledMethods.card) {
    methods.push({
      id: 'card',
      apiMethod: 'CARD',
      label: 'Credit or debit card',
      quotedTotalMinor: quotedTotalFor(invoice, 'CARD'),
    });
    // Same PaymentIntent/Stripe Elements flow as the button above — this is
    // a second, explicitly Stripe-branded entry point to it, not a second
    // payment method at the domain level (there is only one CARD method).
    methods.push({
      id: 'stripe',
      apiMethod: 'CARD',
      label: 'Stripe',
      quotedTotalMinor: quotedTotalFor(invoice, 'CARD'),
    });
  }
  if (invoice.enabledMethods.applePay) {
    methods.push({
      id: 'apple-pay',
      apiMethod: 'WALLET',
      label: 'Apple Pay',
      quotedTotalMinor: quotedTotalFor(invoice, 'WALLET'),
    });
  }
  if (invoice.enabledMethods.googlePay && !invoice.enabledMethods.applePay) {
    // Only one WALLET button is meaningful — Apple Pay's label wins if both
    // are on, since the API cannot distinguish which wallet was actually used.
    methods.push({
      id: 'google-pay',
      apiMethod: 'WALLET',
      label: 'Google Pay',
      quotedTotalMinor: quotedTotalFor(invoice, 'WALLET'),
    });
  }
  if (invoice.enabledMethods.ach) {
    methods.push({
      id: 'ach',
      apiMethod: 'ACH',
      label: 'Bank transfer (ACH)',
      quotedTotalMinor: quotedTotalFor(invoice, 'ACH'),
    });
  }
  return methods;
}

export function PaymentFlow({ invoice, token }: { invoice: PublicInvoice; token: string }) {
  const [step, setStep] = useState<Step>({ kind: 'select' });
  const methods = availableMethods(invoice);

  async function submitPayment(chosenMethod: Method) {
    setStep({ kind: 'processing' });
    try {
      const response = await fetch(`${API_URL}/public/invoices/${token}/payment-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: chosenMethod,
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
        // Stripe (or another hosted-field gateway) needs the customer to
        // complete the payment client-side before anything is settled.
        setStep({ kind: 'card-confirm', clientSecret: body.clientToken });
      } else setStep({ kind: 'pending' });
    } catch (error) {
      setStep({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The network request failed.',
      });
    }
  }

  if (step.kind === 'success') {
    return (
      <div className="mt-6 text-center">
        <p className="text-sm font-medium text-success">Payment successful</p>
        <p className="mt-1 text-xs text-ink-muted">A receipt has been sent to you.</p>
      </div>
    );
  }

  if (step.kind === 'pending') {
    return (
      <div className="mt-6 text-center">
        <p className="text-sm font-medium text-ink-strong">Payment pending</p>
        <p className="mt-1 text-xs text-ink-muted">
          Your bank transfer is being verified. This usually takes 1–2 business days.
        </p>
      </div>
    );
  }

  if (step.kind === 'failure') {
    return (
      <div className="mt-6">
        <p className="text-center text-sm font-medium text-danger">
          Payment couldn&rsquo;t be processed
        </p>
        {step.reason && <p className="mt-1 text-center text-xs text-ink-muted">{step.reason}</p>}
        <button
          type="button"
          onClick={() => setStep({ kind: 'select' })}
          className="mt-4 w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  if (step.kind === 'error') {
    return (
      <div className="mt-6 text-center">
        <p className="text-sm font-medium text-danger">
          We couldn&rsquo;t reach the payment service
        </p>
        <p className="mt-1 text-xs text-ink-muted">{step.message}</p>
        <button
          type="button"
          onClick={() => setStep({ kind: 'select' })}
          className="mt-4 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-strong"
        >
          Back
        </button>
      </div>
    );
  }

  if (step.kind === 'processing') {
    return (
      <div className="mt-6 text-center">
        <p className="text-sm font-medium text-ink-strong">Processing your payment…</p>
      </div>
    );
  }

  if (step.kind === 'card-confirm') {
    return (
      <StripeCardForm
        publishableKey={invoice.stripePublishableKey}
        stripeAccount={invoice.stripeAccountId}
        clientSecret={step.clientSecret}
        returnUrl={typeof window !== 'undefined' ? window.location.href : ''}
        onSucceeded={() => setStep({ kind: 'success' })}
        onFailed={(reason) => setStep({ kind: 'failure', reason })}
        onCancel={() => setStep({ kind: 'select' })}
      />
    );
  }

  if (methods.length === 0) {
    return (
      <div className="mt-6 rounded-md bg-danger-surface p-4 text-center text-sm text-danger">
        This brand has no payment method enabled right now. Please contact them directly.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      {methods.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => submitPayment(m.apiMethod)}
          className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-4 py-2.5 text-left text-sm font-medium text-ink-strong hover:bg-surface-muted"
        >
          <span>{m.label}</span>
          <span className="text-ink-muted">
            {formatMinorForDisplay(m.quotedTotalMinor, toCurrencyCode(invoice.currency))}
          </span>
        </button>
      ))}
    </div>
  );
}
