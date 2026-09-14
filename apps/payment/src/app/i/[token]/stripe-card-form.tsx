'use client';

import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

/**
 * What createIntent (PaymentForm's) actually returns, parsed straight off the
 * API response — same shape /public/invoices/:token/payment-intents has
 * always sent back, just no longer fetched before this form exists.
 */
export interface CreateIntentResult {
  gatewayStatus?: string;
  declineReason?: string | null;
  clientToken?: string | null;
  message?: string;
}

/**
 * The "Card details" block of the payment page — mounted the instant Card is
 * selected, not after a separate "Pay" click, using Stripe's deferred-intent
 * pattern (Elements with `mode: 'payment'`, no client_secret yet) precisely
 * so this can happen without paying the cost a client_secret implies: an
 * intent only actually gets created (Payment row, INITIATE_PAYMENT
 * transition) once the customer submits this form, not the moment they
 * merely look at it. See PaymentForm's own comment for why that distinction
 * matters — this component is what makes both things true at once.
 *
 * Card data is entered directly into Stripe's own iframe (PaymentElement) and
 * confirmed straight against Stripe from the browser — this component and the
 * rest of this app never see a card number (TDD-001 §10.2), which is what
 * keeps PCI scope at SAQ A (TDD-001 §3.3).
 */
export function StripeCardForm({
  publishableKey,
  stripeAccount,
  amountMinor,
  currency,
  accentColor,
  amountLabel,
  returnUrl,
  onCreateIntent,
  onSucceeded,
  onFailed,
  onPending,
  onError,
}: {
  publishableKey: string | null;
  stripeAccount: string | null;
  amountMinor: number;
  currency: string;
  /** Brand Settings > Branding > Payment Page's accent colour — colours the
   * submit button below, exactly as it does in that editor's preview. */
  accentColor: string;
  amountLabel: string;
  returnUrl: string;
  /** Creates the real PaymentIntent server-side — called only once the
   * customer submits, never on mount. Throws (or the promise rejects) for a
   * network/HTTP-level failure; a gateway-level outcome (succeeded, failed,
   * requires the confirm below, or genuinely pending) comes back in the
   * resolved value instead. */
  onCreateIntent: () => Promise<CreateIntentResult>;
  /** clientSecret is null for an outcome settled synchronously inside
   * onCreateIntent (confirmPayment never ran) and set for one confirmed
   * here — the parent passes it on to the API's reconcile fallback, which
   * double-checks that exact attempt's real gateway status before trusting
   * it (see PaymentForm's own reconcile comment). */
  onSucceeded: (clientSecret: string | null) => void;
  onFailed: (clientSecret: string | null, reason: string | null) => void;
  onPending: () => void;
  onError: (message: string) => void;
}) {
  // One Stripe.js load per distinct key/account pair — stable across
  // re-renders of this component for the lifetime of this invoice page.
  const stripePromise = useMemo(
    () => (publishableKey && stripeAccount ? loadStripe(publishableKey, { stripeAccount }) : null),
    [publishableKey, stripeAccount],
  );

  if (!stripePromise) {
    return (
      <p className="mt-5 rounded-lg bg-danger-surface px-4 py-6 text-center text-sm text-danger">
        This brand has not connected a Stripe account yet.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ mode: 'payment', amount: amountMinor, currency: currency.toLowerCase() }}
    >
      <CardFormInner
        returnUrl={returnUrl}
        accentColor={accentColor}
        amountLabel={amountLabel}
        onCreateIntent={onCreateIntent}
        onSucceeded={onSucceeded}
        onFailed={onFailed}
        onPending={onPending}
        onError={onError}
      />
    </Elements>
  );
}

function CardFormInner({
  returnUrl,
  accentColor,
  amountLabel,
  onCreateIntent,
  onSucceeded,
  onFailed,
  onPending,
  onError,
}: {
  returnUrl: string;
  accentColor: string;
  amountLabel: string;
  onCreateIntent: () => Promise<CreateIntentResult>;
  onSucceeded: (clientSecret: string | null) => void;
  onFailed: (clientSecret: string | null, reason: string | null) => void;
  onPending: () => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    // Deferred mode's own required first step: validates and collects the
    // entered details before there is anywhere to send them yet.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setSubmitting(false);
      setError(submitError.message ?? 'Please check your card details.');
      return;
    }

    let result: CreateIntentResult;
    try {
      result = await onCreateIntent();
    } catch (err) {
      setSubmitting(false);
      onError(err instanceof Error ? err.message : 'The network request failed.');
      return;
    }

    if (result.gatewayStatus === 'SUCCEEDED') {
      onSucceeded(null);
      return;
    }
    if (result.gatewayStatus === 'FAILED') {
      onFailed(null, result.declineReason ?? null);
      return;
    }
    if (result.gatewayStatus !== 'REQUIRES_ACTION' || !result.clientToken) {
      onPending();
      return;
    }
    const clientSecret = result.clientToken;

    // redirect: 'if_required' keeps the customer on this page for the common
    // case (card, no 3DS challenge); Stripe still redirects when a method
    // genuinely requires it (e.g. certain bank redirect flows).
    const confirmResult = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });

    if (confirmResult.error) {
      setSubmitting(false);
      // A declined card lands here as an error on the confirm call itself,
      // not as a webhook — there is nothing pending server-side to wait for.
      if (
        confirmResult.error.type === 'card_error' ||
        confirmResult.error.type === 'validation_error'
      ) {
        onFailed(clientSecret, confirmResult.error.message ?? null);
      } else {
        setError(confirmResult.error.message ?? 'Something went wrong.');
      }
      return;
    }

    const status = confirmResult.paymentIntent?.status;
    if (status === 'succeeded') onSucceeded(clientSecret);
    // requires_action et al already redirected away, or is genuinely pending.
    else onFailed(clientSecret, null);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-5">
      <p className="text-sm font-bold text-ink-strong">Card details</p>
      <div className="mt-3">
        <PaymentElement />
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        style={{ backgroundColor: accentColor }}
        className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}
