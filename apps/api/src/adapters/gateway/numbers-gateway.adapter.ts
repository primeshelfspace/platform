import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationError,
  type CaptureInput,
  type CreateIntentInput,
  type GatewayWebhookEvent,
  type PaymentGatewayPort,
  type PaymentIntent,
  type RefundInput,
  type RefundResult,
} from '@sugrpay/shared';
import { ENV, type Env } from '../../config/env.js';

/**
 * NumbersGatewayAdapter — BLOCKED ON DEP-01.
 *
 * TDD-001 §10.3 records why: docs.numbersgateway.com resolves but returns no
 * readable content unauthenticated, and /api/v2 returns 404. The contract could
 * not be read, so this adapter cannot be written honestly yet.
 *
 * It exists as a typed placeholder on purpose. Because the domain depends on
 * PaymentGatewayPort and not on this class, invoicing, calculation, state
 * transitions and their tests are all buildable against FakeGateway while the
 * contract is obtained. Only this file is blocked.
 *
 * QUESTIONS THAT MUST BE ANSWERED BEFORE IMPLEMENTING
 *   1. Auth model — API key, OAuth client credentials, or signed request?
 *   2. Is there a hosted card-entry component that keeps us in SAQ A scope, or
 *      does the card PAN touch our origin? This decides PCI scope, not styling.
 *   3. Idempotency — is there a request-level idempotency key, and how long is
 *      it honoured?
 *   4. Webhooks — signature scheme, replay window, delivery ordering guarantees
 *      (we assume none), and retry policy.
 *   5. Partial capture, partial refund and void: supported, and under what
 *      state constraints?
 *   6. ACH and wallet support, and whether settlement is synchronous.
 *   7. Sandbox availability and test card/account numbers.
 */
@Injectable()
export class NumbersGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = 'numbers-gateway';

  private readonly logger = new Logger(NumbersGatewayAdapter.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    this.logger.warn(
      'NumbersGatewayAdapter is a placeholder: the provider contract is unverified (DEP-01)',
    );
  }

  createIntent(_input: CreateIntentInput): Promise<PaymentIntent> {
    return Promise.reject(this.blocked('createIntent'));
  }

  capture(_input: CaptureInput): Promise<PaymentIntent> {
    return Promise.reject(this.blocked('capture'));
  }

  refund(_input: RefundInput): Promise<RefundResult> {
    return Promise.reject(this.blocked('refund'));
  }

  void(_gatewayReference: string, _brandId: string): Promise<PaymentIntent> {
    return Promise.reject(this.blocked('void'));
  }

  retrieve(_gatewayReference: string, _brandId: string): Promise<PaymentIntent> {
    return Promise.reject(this.blocked('retrieve'));
  }

  verifySignature(
    _payload: string | Buffer,
    _headers: Readonly<Record<string, string>>,
    _brandId: string | null,
  ): Promise<boolean> {
    // Refusing every signature is the safe failure: an unimplemented verifier
    // that returned true would accept forged settlement notifications.
    return Promise.resolve(false);
  }

  parseWebhook(_payload: string | Buffer, _brandId: string | null): GatewayWebhookEvent {
    throw this.blocked('parseWebhook');
  }

  private blocked(operation: string): IntegrationError {
    return new IntegrationError({
      message:
        `NumbersGatewayAdapter.${operation} is not implemented: the provider's API contract ` +
        `is unverified (DEP-01, TDD-001 §10.3). Set PAYMENT_GATEWAY_DRIVER=fake for local work.`,
      errorClass: 'PERMANENT',
      provider: this.providerName,
    });
  }
}
