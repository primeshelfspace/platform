'use client';

import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import type {
  StripeCardCvcElementChangeEvent,
  StripeCardExpiryElementChangeEvent,
  StripeCardNumberElementChangeEvent,
} from '@stripe/stripe-js';
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';

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
 * Matches the field styling the brand-settings "Payment Page" branding
 * preview draws (payment-page-editor.tsx's inputClass) so the two never
 * drift apart — same border colour, radius, shadow and type scale, just
 * expressed as Stripe Elements' own style object instead of Tailwind classes
 * (an Element's contents render inside a Stripe-hosted iframe, which Tailwind
 * cannot reach).
 */
const ELEMENT_STYLE = {
  base: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    fontSmoothing: 'antialiased',
    color: '#0F172A',
    '::placeholder': { color: '#94A3B8' },
  },
  invalid: { color: '#0F172A' },
} as const;

const FIELD_BOX =
  'flex h-10 items-center rounded-lg border bg-white px-3 shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors';

/** Card number / expiry / CVC each need to know only whether they're
 * currently focused, complete, and their own validation message — enough to
 * drive the focus ring and inline error text without re-deriving anything
 * from Stripe on every render. */
interface ElementFieldState {
  complete: boolean;
  focused: boolean;
  error: string | null;
}

const EMPTY_FIELD: ElementFieldState = { complete: false, focused: false, error: null };

function fieldBoxClassName(field: ElementFieldState): string {
  if (field.error) return `${FIELD_BOX} border-danger`;
  if (field.focused) return `${FIELD_BOX} border-ink-strong ring-2 ring-ink-strong ring-offset-1`;
  return `${FIELD_BOX} border-[#D4D4D4]`;
}

/**
 * The "Card details" block of the payment page — mounted the instant Card is
 * selected, not after a separate "Pay" click, using Stripe's deferred-intent
 * pattern (a PaymentIntent only actually gets created — INITIATE_PAYMENT
 * transition — once the customer submits this form, never the moment they
 * merely look at it).
 *
 * Card data is entered directly into three separate Stripe-hosted iframes
 * (CardNumberElement/CardExpiryElement/CardCvcElement) and confirmed straight
 * against Stripe from the browser — this component and the rest of this app
 * never see a card number (TDD-001 §10.2), which is what keeps PCI scope at
 * SAQ A (TDD-001 §3.3). The split elements (rather than the single
 * PaymentElement) exist so this form's visual design can be fully controlled
 * to match the brand-settings preview pixel-for-pixel, while every byte of
 * the card number, expiry and CVC still never leaves Stripe's iframes.
 */
export function StripeCardForm({
  publishableKey,
  stripeAccount,
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
   * onCreateIntent (confirmCardPayment never ran) and set for one confirmed
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
    <Elements stripe={stripePromise}>
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
  const [cardholderName, setCardholderName] = useState('');
  const [numberField, setNumberField] = useState<ElementFieldState>(EMPTY_FIELD);
  const [expiryField, setExpiryField] = useState<ElementFieldState>(EMPTY_FIELD);
  const [cvcField, setCvcField] = useState<ElementFieldState>(EMPTY_FIELD);

  const allComplete = numberField.complete && expiryField.complete && cvcField.complete;

  function handleNumberChange(event: StripeCardNumberElementChangeEvent) {
    setNumberField((prev) => ({
      ...prev,
      complete: event.complete,
      error: event.error?.message ?? null,
    }));
  }

  function handleExpiryChange(event: StripeCardExpiryElementChangeEvent) {
    setExpiryField((prev) => ({
      ...prev,
      complete: event.complete,
      error: event.error?.message ?? null,
    }));
  }

  function handleCvcChange(event: StripeCardCvcElementChangeEvent) {
    setCvcField((prev) => ({
      ...prev,
      complete: event.complete,
      error: event.error?.message ?? null,
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    const cardNumberElement = elements.getElement(CardNumberElement);
    if (!cardNumberElement || !allComplete) {
      setError('Please complete your card details.');
      return;
    }

    setSubmitting(true);
    setError(null);

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

    // handleActions defaults to true: a challenge (3DS et al) opens as an
    // in-page Stripe modal, not a full navigation — the customer stays here
    // for the common case. return_url only matters for the rare redirect-
    // based fallback some issuers still require.
    const confirmResult = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardNumberElement,
        billing_details: cardholderName.trim() ? { name: cardholderName.trim() } : undefined,
      },
      return_url: returnUrl,
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
    // requires_action et al already resolved via the in-page modal above, or
    // is genuinely pending.
    else onFailed(clientSecret, null);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-5">
      <p className="text-sm font-bold text-ink-strong">Card details</p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Card number</span>
          <div className={fieldBoxClassName(numberField)}>
            <CardNumberElement
              className="w-full"
              options={{
                style: ELEMENT_STYLE,
                placeholder: '1234 5678 9012 3456',
                showIcon: false,
                // Stripe's Link autofill button — this brand offers no other
                // payment methods (TDD-001 §3.3's card-only StripeCardForm),
                // so a customer's Link account has nothing to speed up here.
                disableLink: true,
              }}
              onChange={handleNumberChange}
              onFocus={() => setNumberField((prev) => ({ ...prev, focused: true }))}
              onBlur={() => setNumberField((prev) => ({ ...prev, focused: false }))}
            />
          </div>
          {numberField.error && <p className="mt-1 text-xs text-danger">{numberField.error}</p>}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Cardholder name</span>
          <input
            value={cardholderName}
            onChange={(event) => setCardholderName(event.target.value)}
            placeholder="John Smith"
            autoComplete="cc-name"
            className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-ink-strong
                       shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors placeholder:text-slate-400
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong
                       focus-visible:ring-offset-1"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Expiry date</span>
            <div className={fieldBoxClassName(expiryField)}>
              <CardExpiryElement
                className="w-full"
                options={{ style: ELEMENT_STYLE }}
                onChange={handleExpiryChange}
                onFocus={() => setExpiryField((prev) => ({ ...prev, focused: true }))}
                onBlur={() => setExpiryField((prev) => ({ ...prev, focused: false }))}
              />
            </div>
            {expiryField.error && <p className="mt-1 text-xs text-danger">{expiryField.error}</p>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">CVV</span>
            <div className={fieldBoxClassName(cvcField)}>
              <CardCvcElement
                className="w-full"
                options={{ style: ELEMENT_STYLE, placeholder: '•••' }}
                onChange={handleCvcChange}
                onFocus={() => setCvcField((prev) => ({ ...prev, focused: true }))}
                onBlur={() => setCvcField((prev) => ({ ...prev, focused: false }))}
              />
            </div>
            {cvcField.error && <p className="mt-1 text-xs text-danger">{cvcField.error}</p>}
          </label>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || !allComplete || submitting}
        style={{ backgroundColor: accentColor }}
        className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}
