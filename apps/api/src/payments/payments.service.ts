import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';
import {
  IntegrationError,
  PAYMENT_GATEWAY_PORT,
  calculate,
  evaluateTransition,
  type CurrencyCode,
  type InvoiceStatus,
  type Pagination,
  type PaymentGatewayPort,
  type PaymentIntentStatus,
  type PaymentMethod,
  type PublicScope,
  type Scope,
} from '@fenwick/shared';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type ScopedClient } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';

export interface PaymentAttemptResult {
  readonly gatewayStatus: PaymentIntentStatus;
  readonly invoiceStatus: InvoiceStatus;
  readonly declineReason: string | null;
  /** Stripe's client_secret (or another gateway's hosted-field token) — present
   * only while the client still has to complete the payment itself, i.e.
   * REQUIRES_ACTION. Never populated for a synchronous fake-gateway result. */
  readonly clientToken: string | null;
}

/** A listing row — enough for the Payment Gateways tab's Transaction Log to
 * render one line without a second round trip per row. */
export type PaymentListRow = Payment & {
  readonly invoiceNumber: string;
  readonly customerName: string;
};

export interface PaymentListResult {
  readonly data: PaymentListRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * Payment intent creation and settlement (FR-PAY, TDD-001 §8.3).
 *
 * FakeGateway resolves success and decline synchronously — there is no
 * webhook round trip to wait for in those cases, so settlement is applied
 * immediately in the same request. `handleWebhook` exists for the pending
 * case and for a real gateway that settles asynchronously; it shares the
 * same settlement path so the two can never disagree about what "settled"
 * means.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    private readonly queue: QueueService,
  ) {}

  /**
   * Brand Settings → Payment Gateways' Transaction Log. Deliberately not
   * scoped to whichever gateway happens to be connected right now — nothing
   * in this schema records which of the four gateways drove a given payment
   * (only Stripe's own gatewayReference format hints at it), and a brand
   * switching gateways must not make its settlement history disappear. So
   * this is simply the brand's full payment history, newest first.
   */
  async list(scope: Scope, brandId: string, query: Pagination): Promise<PaymentListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where: Prisma.PaymentWhereInput = { brandId };
      const [rows, total] = await Promise.all([
        tx.payment.findMany({
          where,
          include: {
            invoice: { select: { number: true, customer: { select: { displayName: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.payment.count({ where }),
      ]);
      return {
        data: rows.map(({ invoice, ...payment }) => ({
          ...payment,
          invoiceNumber: invoice.number,
          customerName: invoice.customer.displayName,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async createIntent(
    scope: PublicScope,
    method: PaymentMethod,
    attemptNonce: string,
  ): Promise<PaymentAttemptResult> {
    const outcome = await this.prisma.withScope(scope, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: scope.invoiceId },
        include: {
          lineItems: { orderBy: { position: 'asc' } },
          customer: { select: { email: true } },
        },
      });
      if (!invoice) throw new BadRequestException('invoice not found');

      // FR-PAY-005: enforced here, not just hidden in the UI — the method
      // list a client sends is never trusted on its own.
      const settings = await tx.brandSettings.findUnique({ where: { brandId: invoice.brandId } });
      if (!settings || !this.isMethodEnabled(method, settings)) {
        throw new ConflictException(`${method} is not enabled for this brand`);
      }

      // Quotes THIS attempt's total for the chosen method (TDD-001 §9.4) — the
      // card fee applies here, never to the invoice's own stored total.
      const quote = calculate({
        lines: invoice.lineItems.map((l) => ({
          quantity: l.quantity,
          unitPriceMinor: Number(l.unitPriceMinor),
          taxExempt: l.taxExempt,
        })),
        taxRateBp: invoice.taxRateBpApplied,
        cardFeeRateBp: invoice.cardFeeRateBpApplied,
        paymentMethod: method,
      });
      const chargeMinor = quote.totalMinor;

      const idempotencyKey = createHash('sha256')
        .update(`${invoice.id}:${chargeMinor}:${attemptNonce}`)
        .digest('hex');

      const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
      if (existing) {
        // A replay of an already-recorded attempt — whatever sync it needed
        // was already enqueued the first time it settled.
        return {
          result: {
            gatewayStatus: this.paymentStatusToIntentStatus(existing.status),
            invoiceStatus: invoice.status,
            declineReason: existing.declineReason,
            // A retry of an already-recorded attempt does not re-fetch the
            // gateway's client secret; the client should not have gotten here
            // without already holding the one from the original attempt.
            clientToken: null,
          },
          sync: null,
        };
      }

      const originalStatus = invoice.status;
      const initDecision = evaluateTransition('INITIATE_PAYMENT', {
        status: invoice.status,
        lineItemCount: invoice.lineItems.length,
        totalMinor: Number(invoice.totalMinor),
        balanceMinor: Number(invoice.balanceMinor),
        settledMinor: 0,
        customerHasDeliverableEmail: Boolean(invoice.customer.email),
      });
      if (!initDecision.ok) throw new ConflictException(initDecision.message);

      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          brandId: invoice.brandId,
          method,
          amountMinor: chargeMinor,
          currency: invoice.currency,
          status: 'INITIATED',
          idempotencyKey,
        },
      });

      // previousStatus records where to revert on a definitive decline
      // (TDD-001 §8.2) — the status this invoice was in before this attempt,
      // not after.
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: initDecision.to, previousStatus: originalStatus },
      });

      let gatewayResult;
      try {
        gatewayResult = await this.gateway.createIntent({
          idempotencyKey,
          invoiceId: invoice.id,
          brandId: invoice.brandId,
          amountMinor: chargeMinor,
          // Persisted only through currencySchema-validated writes, so this
          // narrowing reflects a real invariant rather than an unchecked cast.
          currency: invoice.currency as CurrencyCode,
          method,
          description: `Invoice ${invoice.number}`,
          customer: { email: invoice.customer.email, name: null },
          returnUrl: `${this.env.PAYMENT_PUBLIC_URL}/i/${invoice.publicToken}`,
        });
      } catch (error) {
        // Transient (e.g. simulated timeout): the invoice stays in
        // PENDING_PAYMENT so the customer can retry; nothing is settled.
        if (error instanceof IntegrationError) {
          this.logger.warn(`gateway createIntent failed: ${error.message}`);
          throw new ConflictException(
            'The payment could not be started. Please try again in a moment.',
          );
        }
        throw error;
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { gatewayReference: gatewayResult.gatewayReference },
      });

      await this.applySettlement(tx, {
        invoiceId: invoice.id,
        paymentId: payment.id,
        invoiceTotalMinor: Number(invoice.totalMinor),
        invoiceStatusBeforeAttempt: originalStatus,
        currentInvoiceStatus: initDecision.to,
        gatewayStatus: gatewayResult.status,
        occurredAt: gatewayResult.occurredAt,
        declineReason: gatewayResult.declineReason ?? null,
      });

      const finalInvoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      return {
        result: {
          gatewayStatus: gatewayResult.status,
          invoiceStatus: finalInvoice.status,
          declineReason: gatewayResult.declineReason ?? null,
          // Only meaningful while the client still has work to do (Stripe's
          // client_secret for REQUIRES_ACTION); a terminal status has nothing
          // left for the client to confirm.
          clientToken:
            gatewayResult.status === 'REQUIRES_ACTION' ? (gatewayResult.clientToken ?? null) : null,
        },
        sync:
          gatewayResult.status === 'SUCCEEDED'
            ? { brandId: invoice.brandId, paymentId: payment.id }
            : null,
      };
    });

    // Enqueued after the transaction commits — see CustomersService.create.
    if (outcome.sync) {
      await this.queue.enqueue('sync', 'zoho-push-payment', outcome.sync);
    }
    return outcome.result;
  }

  /**
   * Webhook receiver for the async path (TDD-001 §8.2, NFR-PRF-022). Not
   * exercised by FakeGateway's success/decline scenarios, which resolve
   * synchronously in createIntent above — this exists for the pending
   * scenario and for a real gateway that settles out of band.
   *
   * `brandId` is whatever the request path already established, and is null for
   * any gateway that routes every tenant through one endpoint — which is the
   * normal case now that Stripe Connect delivers all connected accounts'
   * events to a single platform URL verified by a single platform secret.
   *
   * That makes the signature proof of origin only, not of tenancy, so the
   * brand is re-established from the event itself via the gateway's own
   * resolveBrandId before anything is settled. The check below then holds the
   * same property the per-brand webhook secret used to: an event cannot settle
   * a payment belonging to a brand other than the one it came from, even if a
   * gatewayReference were somehow guessed or collided.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string>>,
    brandId: string | null = null,
  ): Promise<void> {
    if (!(await this.gateway.verifySignature(rawBody, headers, brandId))) {
      throw new BadRequestException('invalid webhook signature');
    }
    const event = this.gateway.parseWebhook(rawBody, brandId);

    // Attribution, for a gateway that multiplexes tenants onto one endpoint.
    // An event that names a provider account nobody has connected is not
    // attributable, and an unattributable event must never settle anything —
    // refusing is the whole point of asking.
    let attributedBrandId = brandId;
    if (this.gateway.resolveBrandId && event.accountRef) {
      attributedBrandId = await this.gateway.resolveBrandId(event);
      if (!attributedBrandId) {
        this.logger.warn(
          `webhook names provider account ${event.accountRef}, which no brand has connected — ignoring`,
        );
        return;
      }
    }

    // Resolution by gateway reference is unscoped on purpose: which brand this
    // payment belongs to is exactly what this lookup exists to discover, and
    // gatewayReference is a provider-issued opaque id, not client-guessable
    // (TDD-001 §12.1). Every write that follows goes through withScope below.
    const payment = await this.prisma.withoutScope(
      'webhook resolution by gateway reference — the scope this event belongs to is not yet known',
      (client) =>
        client.payment.findUnique({
          where: { gatewayReference: event.gatewayReference },
          include: { invoice: { include: { brand: { select: { merchantId: true } } } } },
        }),
    );
    if (!payment) {
      this.logger.warn(`webhook for unknown gateway reference ${event.gatewayReference}`);
      return;
    }

    // Defense in depth: a mismatch means the event came from one brand's
    // connected account but names a payment owned by another — refuse rather
    // than settle the wrong brand's invoice.
    if (attributedBrandId && payment.brandId !== attributedBrandId) {
      this.logger.warn(
        `webhook brand mismatch: event brand ${attributedBrandId} does not own payment ${payment.id} (brand ${payment.brandId})`,
      );
      return;
    }

    // A gateway sends more event types than this platform models (e.g.
    // Stripe's charge.succeeded / charge.updated alongside payment_intent.*).
    // UNKNOWN must be a no-op, not "still processing" — treating it as
    // PROCESSING would regress an already-SETTLED payment's status the
    // moment one of these arrives after the event that actually settled it.
    if (event.type === 'UNKNOWN') {
      this.logger.debug(`ignoring unmodelled webhook event for payment ${payment.id}`);
      return;
    }

    // Out-of-order delivery discard (NFR-INT-012): nothing older than the
    // last processed event for this payment is applied.
    if (payment.lastEventAt && event.occurredAt.getTime() <= payment.lastEventAt.getTime()) {
      this.logger.debug(`discarding stale event for payment ${payment.id}`);
      return;
    }

    const { invoice } = payment;
    const scope: PublicScope = {
      kind: 'PUBLIC',
      merchantId: invoice.brand.merchantId,
      brandId: invoice.brandId,
      invoiceId: invoice.id,
      sourceIp: null,
    };

    const gatewayStatus: PaymentIntentStatus =
      event.type === 'PAYMENT_SUCCEEDED'
        ? 'SUCCEEDED'
        : event.type === 'PAYMENT_FAILED'
          ? 'FAILED'
          : 'PROCESSING';

    await this.prisma.withScope(scope, (tx) =>
      this.applySettlement(tx, {
        invoiceId: invoice.id,
        paymentId: payment.id,
        invoiceTotalMinor: Number(invoice.totalMinor),
        invoiceStatusBeforeAttempt: invoice.previousStatus ?? invoice.status,
        currentInvoiceStatus: invoice.status,
        gatewayStatus,
        occurredAt: event.occurredAt,
        declineReason: event.declineReason ?? null,
      }),
    );

    if (gatewayStatus === 'SUCCEEDED') {
      await this.queue.enqueue('sync', 'zoho-push-payment', {
        brandId: invoice.brandId,
        paymentId: payment.id,
      });
    }
  }

  /**
   * Fallback for when the gateway's webhook cannot reach this platform (no
   * public HTTPS endpoint registered for it yet) but the customer's own
   * browser already holds the gateway's confirmation that the attempt
   * succeeded or failed. This never settles anything on the client's say-so:
   * it re-fetches gatewayReference's real status from the gateway itself
   * (server to server) and only applies that — the client's role is limited
   * to telling this platform which attempt to go check, exactly as if a
   * webhook for it had simply arrived late.
   */
  async confirmClientResult(
    scope: PublicScope,
    gatewayReference: string,
  ): Promise<PaymentAttemptResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { invoiceId: scope.invoiceId, gatewayReference },
        include: { invoice: true },
      });
      if (!payment) throw new BadRequestException('no matching payment attempt for this invoice');

      // Already resolved — by the webhook catching up in the meantime, or by
      // an earlier call here. Idempotent: report it, do not re-apply it.
      if (payment.status !== 'INITIATED' && payment.status !== 'PROCESSING') {
        return {
          gatewayStatus: this.paymentStatusToIntentStatus(payment.status),
          invoiceStatus: payment.invoice.status,
          declineReason: payment.declineReason,
          clientToken: null,
        };
      }

      const intent = await this.gateway.retrieve(gatewayReference, payment.brandId);
      const alreadyNewer =
        payment.lastEventAt && intent.occurredAt.getTime() <= payment.lastEventAt.getTime();

      if (!alreadyNewer && (intent.status === 'SUCCEEDED' || intent.status === 'FAILED')) {
        await this.applySettlement(tx, {
          invoiceId: payment.invoiceId,
          paymentId: payment.id,
          invoiceTotalMinor: Number(payment.invoice.totalMinor),
          invoiceStatusBeforeAttempt: payment.invoice.previousStatus ?? payment.invoice.status,
          currentInvoiceStatus: payment.invoice.status,
          gatewayStatus: intent.status,
          occurredAt: intent.occurredAt,
          declineReason: intent.declineReason ?? null,
        });
        if (intent.status === 'SUCCEEDED') {
          await this.queue.enqueue('sync', 'zoho-push-payment', {
            brandId: payment.brandId,
            paymentId: payment.id,
          });
        }
      }

      const refreshed = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { invoice: true },
      });
      return {
        gatewayStatus: this.paymentStatusToIntentStatus(refreshed.status),
        invoiceStatus: refreshed.invoice.status,
        declineReason: refreshed.declineReason,
        clientToken: null,
      };
    });
  }

  /**
   * The one place a gateway result becomes an invoice/payment state change.
   * Called from the synchronous path, the webhook path, and the client-side
   * confirmation fallback above, so none of the three can disagree about
   * what "settled" means (NFR-INT-010..012).
   */
  private async applySettlement(
    tx: ScopedClient,
    input: {
      invoiceId: string;
      paymentId: string;
      invoiceTotalMinor: number;
      invoiceStatusBeforeAttempt: InvoiceStatus;
      currentInvoiceStatus: InvoiceStatus;
      gatewayStatus: PaymentIntentStatus;
      occurredAt: Date;
      declineReason: string | null;
    },
  ): Promise<void> {
    const { invoiceId, paymentId, invoiceTotalMinor, gatewayStatus, occurredAt, declineReason } =
      input;
    // SETTLE_FULL and PAYMENT_FAILED do not gate on line count; only ISSUE
    // does. Passed as 0 here rather than threading it through unused.
    const lineItemCount = 0;

    if (gatewayStatus === 'SUCCEEDED') {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'SETTLED', settledAt: occurredAt, lastEventAt: occurredAt },
      });

      const decision = evaluateTransition('SETTLE_FULL', {
        status: input.currentInvoiceStatus,
        lineItemCount,
        totalMinor: invoiceTotalMinor,
        balanceMinor: 0,
        settledMinor: invoiceTotalMinor,
        customerHasDeliverableEmail: true,
      });
      if (!decision.ok) {
        this.logger.error(`SETTLE_FULL refused for invoice ${invoiceId}: ${decision.message}`);
        return;
      }

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: decision.to, balanceMinor: 0, paidAt: occurredAt, previousStatus: null },
      });
      await tx.invoiceEvent.create({
        data: {
          invoiceId,
          eventType: 'PAYMENT_SETTLED',
          fromStatus: input.currentInvoiceStatus,
          toStatus: decision.to,
          actor: 'system',
        },
      });
      return;
    }

    if (gatewayStatus === 'FAILED') {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED', declineReason, lastEventAt: occurredAt },
      });

      const decision = evaluateTransition('PAYMENT_FAILED', {
        status: input.currentInvoiceStatus,
        previousStatus: input.invoiceStatusBeforeAttempt,
        lineItemCount,
        totalMinor: invoiceTotalMinor,
        balanceMinor: invoiceTotalMinor,
        settledMinor: 0,
        customerHasDeliverableEmail: true,
      });
      if (!decision.ok) {
        this.logger.error(`PAYMENT_FAILED refused for invoice ${invoiceId}: ${decision.message}`);
        return;
      }

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: decision.to, previousStatus: null },
      });
      await tx.invoiceEvent.create({
        data: {
          invoiceId,
          eventType: 'PAYMENT_FAILED',
          fromStatus: input.currentInvoiceStatus,
          toStatus: decision.to,
          actor: 'system',
          payload: declineReason ? { declineReason } : undefined,
        },
      });
      return;
    }

    // PROCESSING: invoice already sits in PENDING_PAYMENT from createIntent;
    // nothing changes until a later webhook reports a terminal status.
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'PROCESSING', lastEventAt: occurredAt },
    });
  }

  /** Approximates a stored Payment row's status as an intent status for the
   * idempotent-replay fast path. INITIATED/CANCELLED map to PROCESSING as a
   * safe default — a client retrying with the same nonce this soon after
   * either of those is not a case the UI needs to distinguish precisely. */
  private paymentStatusToIntentStatus(status: Payment['status']): PaymentIntentStatus {
    switch (status) {
      case 'SETTLED':
      case 'PARTIALLY_REFUNDED':
      case 'REFUNDED':
        return 'SUCCEEDED';
      case 'FAILED':
        return 'FAILED';
      default:
        return 'PROCESSING';
    }
  }

  /**
   * FR-PAY-005. WALLET is one PaymentMethod value at this layer but two
   * separately-enabled toggles at the brand level (Apple Pay and Google Pay
   * have distinct real-world merchant registrations) — a WALLET attempt is
   * permitted if either is on. Distinguishing which wallet the customer
   * actually used would need its own field once real wallet integration
   * lands; nothing today produces that distinction to enforce against.
   */
  private isMethodEnabled(
    method: PaymentMethod,
    settings: {
      cardEnabled: boolean;
      applePayEnabled: boolean;
      googlePayEnabled: boolean;
      achEnabled: boolean;
      checkEnabled: boolean;
    },
  ): boolean {
    switch (method) {
      case 'CARD':
        return settings.cardEnabled;
      case 'WALLET':
        return settings.applePayEnabled || settings.googlePayEnabled;
      case 'ACH':
        return settings.achEnabled;
      case 'CHECK':
        return settings.checkEnabled;
      case 'MANUAL':
        return true; // internal recording of an offline payment, not a customer choice
    }
  }
}
