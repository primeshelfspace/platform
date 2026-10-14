import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationError,
  type CaptureInput,
  type CreateIntentInput,
  type GatewayWebhookEvent,
  type PaymentGatewayPort,
  type PaymentIntent,
  type PaymentIntentStatus,
  type RefundInput,
  type RefundResult,
} from '@sugrpay/shared';

/**
 * FakeGateway — the local and test implementation of PaymentGatewayPort
 * (TER-001 §3.2).
 *
 * Deterministic by design: the same input always produces the same outcome, so
 * a failing test is a real failure and not a flaky provider. Scenarios are
 * selected explicitly through metadata, or by magic amounts so that a manual
 * click-through can exercise a decline without editing code.
 *
 *   metadata.scenario = success | decline | pending | timeout
 *   amount ending 11  → decline
 *   amount ending 22  → pending, settles on a simulated webhook
 *   amount ending 33  → timeout (transient error)
 *   anything else     → success
 */
export const FAKE_GATEWAY_WEBHOOK_SECRET = 'fake-gateway-local-secret';

type Scenario = 'success' | 'decline' | 'pending' | 'timeout';

interface StoredIntent {
  intent: PaymentIntent;
  scenario: Scenario;
  idempotencyKey: string;
  invoiceId: string;
}

@Injectable()
export class FakeGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = 'fake-gateway';

  private readonly logger = new Logger(FakeGatewayAdapter.name);
  private readonly byReference = new Map<string, StoredIntent>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private clock: () => Date = () => new Date();

  /** Tests pin the clock so timestamps are assertable. */
  setClock(clock: () => Date): void {
    this.clock = clock;
  }

  reset(): void {
    this.byReference.clear();
    this.byIdempotencyKey.clear();
  }

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    // Idempotency first: a repeated key returns the original intent rather
    // than creating a second charge (TDD-001 §8.3).
    const existingReference = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existingReference) {
      const existing = this.byReference.get(existingReference);
      if (existing) return existing.intent;
    }

    const scenario = this.resolveScenario(input);

    if (scenario === 'timeout') {
      throw new IntegrationError({
        message: 'simulated gateway timeout',
        errorClass: 'TRANSIENT',
        provider: this.providerName,
        providerMessage: 'Gateway did not respond within 30000ms',
      });
    }

    const gatewayReference = `fake_pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const status: PaymentIntentStatus =
      scenario === 'success' ? 'SUCCEEDED' : scenario === 'decline' ? 'FAILED' : 'PROCESSING';

    const intent: PaymentIntent = {
      gatewayReference,
      status,
      amountMinor: input.amountMinor,
      currency: input.currency,
      actionUrl: scenario === 'pending' ? `${input.returnUrl}?simulated=pending` : null,
      clientToken: `fake_secret_${gatewayReference}`,
      occurredAt: this.clock(),
      declineReason: scenario === 'decline' ? 'card_declined: insufficient funds' : null,
      raw: { simulated: true, scenario },
    };

    this.byReference.set(gatewayReference, {
      intent,
      scenario,
      idempotencyKey: input.idempotencyKey,
      invoiceId: input.invoiceId,
    });
    this.byIdempotencyKey.set(input.idempotencyKey, gatewayReference);

    this.logger.debug(`intent ${gatewayReference} → ${status} (scenario: ${scenario})`);
    return intent;
  }

  async capture(input: CaptureInput): Promise<PaymentIntent> {
    const stored = this.require(input.gatewayReference);
    const intent: PaymentIntent = {
      ...stored.intent,
      status: 'SUCCEEDED',
      amountMinor: input.amountMinor ?? stored.intent.amountMinor,
      occurredAt: this.clock(),
    };
    this.byReference.set(input.gatewayReference, { ...stored, intent });
    return intent;
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const stored = this.require(input.gatewayReference);
    if (input.amountMinor > stored.intent.amountMinor) {
      throw new IntegrationError({
        message: 'refund exceeds the captured amount',
        errorClass: 'VALIDATION',
        provider: this.providerName,
        providerMessage: 'Refund amount greater than original charge',
      });
    }
    return {
      refundReference: `fake_re_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      amountMinor: input.amountMinor,
      status: 'SUCCEEDED',
      occurredAt: this.clock(),
    };
  }

  async void(gatewayReference: string, _brandId: string): Promise<PaymentIntent> {
    const stored = this.require(gatewayReference);
    const intent: PaymentIntent = {
      ...stored.intent,
      status: 'CANCELLED',
      occurredAt: this.clock(),
    };
    this.byReference.set(gatewayReference, { ...stored, intent });
    return intent;
  }

  async retrieve(gatewayReference: string, _brandId: string): Promise<PaymentIntent> {
    return this.require(gatewayReference).intent;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- signature match with the async, per-brand-secret-lookup Stripe implementation
  async verifySignature(
    payload: string | Buffer,
    headers: Readonly<Record<string, string>>,
    _brandId: string | null,
  ): Promise<boolean> {
    const provided = headers['x-fake-signature'] ?? headers['X-Fake-Signature'];
    if (!provided) return false;

    const expected = this.sign(payload);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Constant-time compare, and a length check first because timingSafeEqual
    // throws on mismatched lengths.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: string | Buffer, _brandId: string | null): GatewayWebhookEvent {
    const body = JSON.parse(payload.toString()) as Record<string, unknown>;
    return {
      id: String(body['id'] ?? randomUUID()),
      type: (body['type'] as GatewayWebhookEvent['type']) ?? 'UNKNOWN',
      gatewayReference: String(body['gatewayReference'] ?? ''),
      amountMinor: typeof body['amountMinor'] === 'number' ? body['amountMinor'] : null,
      currency: (body['currency'] as GatewayWebhookEvent['currency']) ?? null,
      occurredAt: body['occurredAt'] ? new Date(String(body['occurredAt'])) : this.clock(),
      declineReason: (body['declineReason'] as string | undefined) ?? null,
      raw: body,
    };
  }

  // --- Test and local-development affordances ------------------------------

  sign(payload: string | Buffer): string {
    return createHmac('sha256', FAKE_GATEWAY_WEBHOOK_SECRET).update(payload).digest('hex');
  }

  /**
   * Builds a signed webhook body for a stored intent, so local development and
   * integration tests can drive settlement without a real provider callback.
   */
  simulateWebhook(
    gatewayReference: string,
    type: GatewayWebhookEvent['type'],
    overrides: Partial<{ occurredAt: Date; amountMinor: number }> = {},
  ): { body: string; headers: Record<string, string> } {
    const stored = this.require(gatewayReference);
    const body = JSON.stringify({
      id: `fake_evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      type,
      gatewayReference,
      amountMinor: overrides.amountMinor ?? stored.intent.amountMinor,
      currency: stored.intent.currency,
      occurredAt: (overrides.occurredAt ?? this.clock()).toISOString(),
    });
    return { body, headers: { 'x-fake-signature': this.sign(body) } };
  }

  private resolveScenario(input: CreateIntentInput): Scenario {
    const explicit = input.metadata?.['scenario'];
    if (
      explicit === 'success' ||
      explicit === 'decline' ||
      explicit === 'pending' ||
      explicit === 'timeout'
    ) {
      return explicit;
    }
    switch (Math.abs(input.amountMinor) % 100) {
      case 11:
        return 'decline';
      case 22:
        return 'pending';
      case 33:
        return 'timeout';
      default:
        return 'success';
    }
  }

  private require(gatewayReference: string): StoredIntent {
    const stored = this.byReference.get(gatewayReference);
    if (!stored) {
      throw new IntegrationError({
        message: `unknown gateway reference ${gatewayReference}`,
        errorClass: 'PERMANENT',
        provider: this.providerName,
        httpStatus: 404,
      });
    }
    return stored;
  }
}
