/**
 * PaymentGatewayPort (TDD-001 §10.2).
 *
 * The domain depends on this interface; adapters implement it. This boundary is
 * why the invoicing, calculation and state-machine work is not blocked on
 * DEP-01 — Numbers Gateway's contract is unverified, so only the adapter is
 * blocked. Everything else builds and tests against FakeGateway.
 *
 * Operations must be idempotent on `idempotencyKey`: a repeated call with the
 * same key returns the original intent rather than charging twice.
 */

import type { CurrencyCode, Minor } from '../money/money.js';
import type { PaymentMethod } from '../money/calculation.js';

export const PAYMENT_INTENT_STATUSES = [
  'REQUIRES_ACTION',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export interface CreateIntentInput {
  /** Hash of (invoice id, amount, attempt nonce). See TDD-001 §8.3. */
  readonly idempotencyKey: string;
  readonly invoiceId: string;
  readonly brandId: string;
  readonly amountMinor: Minor;
  readonly currency: CurrencyCode;
  readonly method: PaymentMethod;
  readonly description: string;
  readonly customer: {
    readonly email: string | null;
    readonly name: string | null;
  };
  /** Where the gateway returns the customer after a redirect flow. */
  readonly returnUrl: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentIntent {
  readonly gatewayReference: string;
  readonly status: PaymentIntentStatus;
  readonly amountMinor: Minor;
  readonly currency: CurrencyCode;
  /** Present when the customer must be redirected or a form must be hosted. */
  readonly actionUrl?: string | null;
  /** Client secret or hosted-field token, if the gateway uses one. */
  readonly clientToken?: string | null;
  /** Gateway's own timestamp, used for out-of-order webhook rejection. */
  readonly occurredAt: Date;
  readonly declineReason?: string | null;
  readonly raw?: unknown;
}

export interface CaptureInput {
  readonly gatewayReference: string;
  readonly brandId: string;
  readonly amountMinor?: Minor;
  readonly idempotencyKey: string;
}

export interface RefundInput {
  readonly gatewayReference: string;
  readonly brandId: string;
  readonly amountMinor: Minor;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly refundReference: string;
  readonly amountMinor: Minor;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly occurredAt: Date;
}

export const GATEWAY_EVENT_TYPES = [
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'PAYMENT_PENDING',
  'PAYMENT_CANCELLED',
  'REFUND_SUCCEEDED',
  'REFUND_FAILED',
  'UNKNOWN',
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

export interface GatewayWebhookEvent {
  readonly id: string;
  readonly type: GatewayEventType;
  readonly gatewayReference: string;
  readonly amountMinor: Minor | null;
  readonly currency: CurrencyCode | null;
  /**
   * The gateway's timestamp for the event, NOT receipt time. Gateways do not
   * guarantee ordered delivery, so this is compared against the last processed
   * event for the payment and anything older is discarded (NFR-INT-012).
   */
  readonly occurredAt: Date;
  readonly declineReason?: string | null;
  /**
   * The provider-side account this event belongs to, for gateways where one
   * endpoint serves many accounts — Stripe Connect delivers every connected
   * account's events to a single platform endpoint, tagged with `account`.
   * Null for a gateway with one account and therefore nothing to disambiguate.
   */
  readonly accountRef?: string | null;
  readonly raw: unknown;
}

export interface PaymentGatewayPort {
  readonly providerName: string;

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  capture(input: CaptureInput): Promise<PaymentIntent>;
  refund(input: RefundInput): Promise<RefundResult>;
  void(gatewayReference: string, brandId: string): Promise<PaymentIntent>;
  retrieve(gatewayReference: string, brandId: string): Promise<PaymentIntent>;

  /**
   * Verifies the webhook signature. Resolves to false rather than throwing,
   * so an unsigned probe is a 401 and not a 500. Async because a per-tenant
   * provider (Stripe) must look up that brand's own signing secret before it
   * can check anything.
   *
   * `brandId` is which brand's credentials to verify against — required for
   * a provider whose signing secret is per-tenant (Stripe: each brand has its
   * own Stripe account and webhook secret); null for a provider with one
   * shared secret regardless of brand (FakeGateway, in local dev/tests).
   */
  verifySignature(
    payload: string | Buffer,
    headers: Readonly<Record<string, string>>,
    brandId: string | null,
  ): Promise<boolean>;

  /** Parses a verified payload into the platform's event shape. */
  parseWebhook(payload: string | Buffer, brandId: string | null): GatewayWebhookEvent;

  /**
   * Which brand owns the account an event came from, where the gateway routes
   * many tenants through one endpoint. Optional: a single-account gateway has
   * nothing to resolve and omits it, and the caller falls back to whatever
   * brand the request path already established.
   *
   * This is what preserves tenant isolation once a per-brand webhook URL (and
   * its per-brand signing secret) is replaced by one shared endpoint — the
   * signature then proves only that the event came from the provider, not
   * which tenant it concerns.
   */
  resolveBrandId?(event: GatewayWebhookEvent): Promise<string | null>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PaymentGatewayPort');
