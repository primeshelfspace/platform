'use client';

import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

/**
 * The "Card details" block of the payment page.
 *
 * Card data is entered directly into Stripe's own iframe (PaymentElement) and
 * confirmed straight against Stripe from the browser — this component and the
 * rest of this app never see a card number, and the client_secret below is the
 * only thing standing between "form" and "money moved" (TDD-001 §10.2). That
 * is the one place the real page cannot match the admin editor's preview,
 * which draws plain card inputs; everything around it — the heading, the
 * accent-coloured full-width "Pay {amount}" button — is that design.
 *
 * Both Stripe props come from the invoice API response rather than a
 * build-time NEXT_PUBLIC_ env var. Under Stripe Connect the key is the
 * platform's, but `stripeAccount` names the brand's connected account — the
 * PaymentIntent was created on that account, so Stripe.js has to be
 * initialised for it or the client_secret will not resolve. Which brand this
 * is is only known at request time, so neither value can be baked into the
 * bundle.
 */
export function StripeCardForm({
  publishableKey,
  stripeAccount,
  clientSecret,
  accentColor,
  amountLabel,
  returnUrl,
  onSucceeded,
  onFailed,
  onCancel,
}: {
  publishableKey: string | null;
  stripeAccount: string | null;
  clientSecret: string;
  /** Brand Settings > Branding > Payment Page's accent colour — colours the
   * submit button below, exactly as it does in that editor's preview. */
  accentColor: string;
  amountLabel: string;
  returnUrl: string;
  onSucceeded: () => void;
  onFailed: (reason: string | null) => void;
  onCancel: () => void;
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
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardFormInner
        returnUrl={returnUrl}
        accentColor={accentColor}
        amountLabel={amountLabel}
        onSucceeded={onSucceeded}
        onFailed={onFailed}
        onCancel={onCancel}
      />
    </Elements>
  );
}

function CardFormInner({
  returnUrl,
  accentColor,
  amountLabel,
  onSucceeded,
  onFailed,
  onCancel,
}: {
  returnUrl: string;
  accentColor: string;
  amountLabel: string;
  onSucceeded: () => void;
  onFailed: (reason: string | null) => void;
  onCancel: () => void;
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

    // redirect: 'if_required' keeps the customer on this page for the common
    // case (card, no 3DS challenge); Stripe still redirects when a method
    // genuinely requires it (e.g. certain bank redirect flows).
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });

    if (result.error) {
      setSubmitting(false);
      // A declined card lands here as an error on the confirm call itself,
      // not as a webhook — there is nothing pending server-side to wait for.
      if (result.error.type === 'card_error' || result.error.type === 'validation_error') {
        onFailed(result.error.message ?? null);
      } else {
        setError(result.error.message ?? 'Something went wrong.');
      }
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded') onSucceeded();
    // requires_action et al already redirected away, or is genuinely pending.
    else onFailed(null);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5">
      <p className="text-sm font-bold text-ink-strong">Card details</p>
      <div className="mt-3">
        <PaymentElement />
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || submitting}
        style={{ backgroundColor: accentColor }}
        className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="mt-2 w-full text-center text-xs text-ink-muted hover:text-ink-strong"
      >
        Back
      </button>
    </form>
  );
}
