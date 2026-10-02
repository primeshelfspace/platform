import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  IntegrationError,
  type CaptureInput,
  type CreateIntentInput,
  type CurrencyCode,
  type GatewayWebhookEvent,
  type PaymentGatewayPort,
  type PaymentIntent,
  type PaymentIntentStatus,
  type RefundInput,
  type RefundResult,
} from '@sugrpay/shared';
import { ENV, type Env } from '../../config/env.js';
import { StripeAccountService } from '../../integrations/stripe-account.service.js';

/**
 * StripeGatewayAdapter — real PaymentGatewayPort implementation (TDD-001 §10.2).
 *
 * Multi-tenant via Stripe Connect (Standard). There is no per-brand secret key
 * for this adapter to hold: every method runs under the PLATFORM's client with
 * `{ stripeAccount }` set to the brand's connected account, which is what keeps
 * brand A's payments created, captured, refunded and settled strictly against
 * brand A's own Stripe account. The brand grants that access through Stripe's
 * consent screen and can revoke it from its own dashboard.
 *
 * Card data never reaches this process: the payment page collects it via
 * Stripe Elements client-side and confirms the PaymentIntent directly against
 * Stripe using the `clientToken` (client_secret) this adapter returns. This
 * keeps the integration at PCI SAQ A rather than SAQ D. The webhook is the
 * authoritative settlement signal (NFR-INT-010) — `createIntent`'s own return
 * status is provisional (REQUIRES_ACTION/PROCESSING) until Stripe confirms.
 */
@Injectable()
export class StripeGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = 'stripe';

  private readonly logger = new Logger(StripeGatewayAdapter.name);

  constructor(
    private readonly stripeAccounts: StripeAccountService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    const stripeAccount = await this.accountFor(input.brandId);
    const paymentMethodTypes = this.paymentMethodTypesFor(input);

    try {
      const pi = await this.platform().paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          description: input.description,
          payment_method_types: paymentMethodTypes,
          receipt_email: input.customer.email ?? undefined,
          metadata: {
            invoiceId: input.invoiceId,
            brandId: input.brandId,
            ...input.metadata,
          },
        },
        { idempotencyKey: input.idempotencyKey, stripeAccount },
      );

      return this.toPaymentIntent(pi, input.currency);
    } catch (error) {
      throw this.wrap(error, 'createIntent');
    }
  }

  async capture(input: CaptureInput): Promise<PaymentIntent> {
    const stripeAccount = await this.accountFor(input.brandId);
    try {
      const pi = await this.platform().paymentIntents.capture(
        input.gatewayReference,
        input.amountMinor === undefined ? undefined : { amount_to_capture: input.amountMinor },
        { idempotencyKey: input.idempotencyKey, stripeAccount },
      );
      return this.toPaymentIntent(pi, pi.currency.toUpperCase() as CurrencyCode);
    } catch (error) {
      throw this.wrap(error, 'capture');
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripeAccount = await this.accountFor(input.brandId);
    try {
      const refund = await this.platform().refunds.create(
        {
          payment_intent: input.gatewayReference,
          amount: input.amountMinor,
          reason: this.mapRefundReason(input.reason),
        },
        { idempotencyKey: input.idempotencyKey, stripeAccount },
      );
      return {
        refundReference: refund.id,
        amountMinor: refund.amount,
        status:
          refund.status === 'succeeded'
            ? 'SUCCEEDED'
            : refund.status === 'failed'
              ? 'FAILED'
              : 'PENDING',
        occurredAt: new Date(refund.created * 1000),
      };
    } catch (error) {
      throw this.wrap(error, 'refund');
    }
  }

  async void(gatewayReference: string, brandId: string): Promise<PaymentIntent> {
    const stripeAccount = await this.accountFor(brandId);
    try {
      const pi = await this.platform().paymentIntents.cancel(gatewayReference, undefined, {
        stripeAccount,
      });
      return this.toPaymentIntent(pi, pi.currency.toUpperCase() as CurrencyCode);
    } catch (error) {
      throw this.wrap(error, 'void');
    }
  }

  async retrieve(gatewayReference: string, brandId: string): Promise<PaymentIntent> {
    const stripeAccount = await this.accountFor(brandId);
    try {
      const pi = await this.platform().paymentIntents.retrieve(gatewayReference, undefined, {
        stripeAccount,
      });
      return this.toPaymentIntent(pi, pi.currency.toUpperCase() as CurrencyCode);
    } catch (error) {
      throw this.wrap(error, 'retrieve');
    }
  }

  /**
   * One signing secret for the whole platform. Under Connect every connected
   * account's events arrive at a single endpoint, so `brandId` is null here and
   * a valid signature proves only that Stripe sent this — not which tenant it
   * concerns. That second question is answered by resolveBrandId below, and the
   * two together are what the old per-brand secret used to establish alone.
   */
  async verifySignature(
    payload: string | Buffer,
    headers: Readonly<Record<string, string>>,
    _brandId: string | null,
  ): Promise<boolean> {
    const signature = headers['stripe-signature'] ?? headers['Stripe-Signature'];
    if (!signature) return false;

    const webhookSecret = this.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured — refusing every webhook');
      return false;
    }

    try {
      // constructEvent makes no network request, so the client here is just a
      // vehicle for the SDK's own signature verification.
      this.platform().webhooks.constructEvent(payload, signature, webhookSecret);
      return true;
    } catch (error) {
      this.logger.warn(`stripe webhook signature rejected: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Called only after verifySignature has already checked the signature —
   * re-deriving the event here is just a JSON parse, not a second trust check.
   * `brandId` is accepted for interface symmetry; the tenant now comes off the
   * event's own `account` field instead.
   */
  parseWebhook(payload: string | Buffer, _brandId: string | null): GatewayWebhookEvent {
    const event = JSON.parse(payload.toString()) as Stripe.Event;
    const object = event.data.object as Stripe.PaymentIntent | Stripe.Charge;
    const gatewayReference =
      'payment_intent' in object && typeof object.payment_intent === 'string'
        ? object.payment_intent
        : object.id;

    return {
      id: event.id,
      type: this.mapEventType(event.type),
      gatewayReference,
      amountMinor: 'amount' in object ? object.amount : null,
      currency: 'currency' in object ? (object.currency.toUpperCase() as CurrencyCode) : null,
      occurredAt: new Date(event.created * 1000),
      declineReason:
        'last_payment_error' in object ? (object.last_payment_error?.message ?? null) : null,
      // Present on connected-account events; absent on events about the
      // platform's own account, which this system has no payments under.
      accountRef: event.account ?? null,
      raw: event,
    };
  }

  /** Maps the connected account an event came from back to the brand that
   * authorised it. Null when the event carries no account, or names one no
   * brand has connected — the caller treats either as "cannot attribute" and
   * declines to settle rather than guessing. */
  async resolveBrandId(event: GatewayWebhookEvent): Promise<string | null> {
    if (!event.accountRef) return null;
    return this.stripeAccounts.findBrandIdByAccountId(event.accountRef);
  }

  private platform(): Stripe {
    return this.stripeAccounts.platformClient();
  }

  /** The connected account every request for this brand must be made against.
   * Absent means the brand never completed the Connect flow. */
  private async accountFor(brandId: string): Promise<string> {
    const accountId = await this.stripeAccounts.getAccountIdForBrand(brandId);
    if (!accountId) {
      throw new IntegrationError({
        message: `Stripe is not connected for brand ${brandId}`,
        errorClass: 'VALIDATION',
        provider: this.providerName,
      });
    }
    return accountId;
  }

  private paymentMethodTypesFor(input: CreateIntentInput): string[] {
    switch (input.method) {
      case 'ACH':
        return ['us_bank_account'];
      case 'CARD':
      case 'WALLET':
        // Apple Pay / Google Pay are card-network wallets from Stripe's side —
        // the Payment Element on the client offers whichever the browser supports.
        return ['card'];
      default:
        throw new IntegrationError({
          message: `${input.method} is not a Stripe-routable payment method`,
          errorClass: 'VALIDATION',
          provider: this.providerName,
        });
    }
  }

  private toPaymentIntent(pi: Stripe.PaymentIntent, currency: CurrencyCode): PaymentIntent {
    return {
      gatewayReference: pi.id,
      status: this.mapStatus(pi),
      amountMinor: pi.amount,
      currency,
      actionUrl: null,
      clientToken: pi.client_secret,
      occurredAt: new Date(pi.created * 1000),
      declineReason: pi.last_payment_error?.message ?? null,
      raw: pi,
    };
  }

  private mapStatus(pi: Stripe.PaymentIntent): PaymentIntentStatus {
    switch (pi.status) {
      case 'succeeded':
        return 'SUCCEEDED';
      case 'processing':
        return 'PROCESSING';
      case 'canceled':
        return 'CANCELLED';
      case 'requires_payment_method':
        // A brand-new intent starts here too, with no error attached — only a
        // card that just failed carries last_payment_error, which is the only
        // way to tell "declined, try another method" from "not attempted yet".
        return pi.last_payment_error ? 'FAILED' : 'REQUIRES_ACTION';
      default:
        // requires_confirmation, requires_action, requires_capture
        return 'REQUIRES_ACTION';
    }
  }

  private mapEventType(type: Stripe.Event.Type): GatewayWebhookEvent['type'] {
    switch (type) {
      case 'payment_intent.succeeded':
        return 'PAYMENT_SUCCEEDED';
      case 'payment_intent.payment_failed':
        return 'PAYMENT_FAILED';
      case 'payment_intent.processing':
        return 'PAYMENT_PENDING';
      case 'payment_intent.canceled':
        return 'PAYMENT_CANCELLED';
      case 'charge.refunded':
        return 'REFUND_SUCCEEDED';
      default:
        return 'UNKNOWN';
    }
  }

  private mapRefundReason(
    reason: string | undefined,
  ): Stripe.RefundCreateParams.Reason | undefined {
    if (reason === 'duplicate' || reason === 'fraudulent' || reason === 'requested_by_customer') {
      return reason;
    }
    return undefined;
  }

  private wrap(error: unknown, operation: string): IntegrationError {
    if (error instanceof Stripe.errors.StripeError) {
      return new IntegrationError({
        message: `stripe ${operation} failed: ${error.message}`,
        errorClass: this.classify(error),
        provider: this.providerName,
        providerMessage: error.message,
        providerCode: error.code,
        httpStatus: error.statusCode,
        cause: error,
      });
    }
    return new IntegrationError({
      message: `stripe ${operation} failed`,
      errorClass: 'PERMANENT',
      provider: this.providerName,
      cause: error,
    });
  }

  private classify(error: Stripe.errors.StripeError): IntegrationError['errorClass'] {
    if (error instanceof Stripe.errors.StripeAuthenticationError) return 'AUTHENTICATION';
    if (error instanceof Stripe.errors.StripeRateLimitError) return 'TRANSIENT';
    if (error instanceof Stripe.errors.StripeConnectionError) return 'TRANSIENT';
    if (error instanceof Stripe.errors.StripeAPIError) return 'TRANSIENT';
    if (error instanceof Stripe.errors.StripeInvalidRequestError) return 'VALIDATION';
    if (error instanceof Stripe.errors.StripeCardError) return 'CONFLICT';
    return 'PERMANENT';
  }
}
