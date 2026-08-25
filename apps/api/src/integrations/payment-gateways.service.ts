import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentGatewayProvider, Scope } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { StripeAccountService } from './stripe-account.service.js';

/** Gateways with no credential handshake behind them yet — connecting one is
 * just recording the brand's choice (see class doc). STRIPE is excluded: it
 * completes a real OAuth authorisation and is handled by StripeAccountService
 * instead. */
const MANUAL_PROVIDERS = ['PAYPAL', 'SQUARE', 'AUTHORIZE_NET'] as const;
type ManualProvider = (typeof MANUAL_PROVIDERS)[number];

function isManualProvider(provider: PaymentGatewayProvider): provider is ManualProvider {
  return (MANUAL_PROVIDERS as readonly string[]).includes(provider);
}

export const GATEWAY_DISPLAY_NAMES: Record<PaymentGatewayProvider, string> = {
  STRIPE: 'Stripe',
  PAYPAL: 'PayPal',
  SQUARE: 'Square',
  AUTHORIZE_NET: 'Authorize.net',
};

export interface PaymentGatewaySummary {
  readonly provider: PaymentGatewayProvider;
  readonly displayName: string;
  readonly connected: boolean;
  /** Stripe's own account label (business name or account id); null for a
   * manual gateway, which has nothing of its own to display. */
  readonly accountLabel: string | null;
  readonly connectedAt: Date | null;
}

/**
 * Brand Settings → Payment Gateways: Stripe, PayPal, Square and
 * Authorize.net side by side. Stripe alone has a working credential
 * handshake (StripeAccountService, Stripe Connect OAuth); the other three
 * have no such integration built yet, so connecting one only records that
 * the brand picked it — no charge this platform processes actually routes
 * through PayPal, Square or Authorize.net today. That is the same honest gap
 * Payment Methods already calls out for Apple Pay, Google Pay and manual
 * check ("has no visible effect today").
 *
 * All four share one IntegrationConnection row per brand (unique on
 * brandId+provider) — the same table Zoho and Stripe already use — so a
 * brand can hold at most one CONNECTED row per provider, and reconnecting
 * after a disconnect is just flipping status back.
 */
@Injectable()
export class PaymentGatewaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeAccountService,
  ) {}

  async list(scope: Scope, brandId: string): Promise<PaymentGatewaySummary[]> {
    const [stripeStatus, manualRows] = await Promise.all([
      this.stripe.getStatus(scope, brandId),
      this.prisma.withScope(scope, (tx) =>
        tx.integrationConnection.findMany({
          where: { brandId, provider: { in: [...MANUAL_PROVIDERS] } },
          select: { provider: true, status: true, updatedAt: true },
        }),
      ),
    ]);

    const manualByProvider = new Map(manualRows.map((row) => [row.provider, row]));

    return (['STRIPE', ...MANUAL_PROVIDERS] as const).map((provider) => {
      if (provider === 'STRIPE') {
        return {
          provider,
          displayName: GATEWAY_DISPLAY_NAMES.STRIPE,
          connected: stripeStatus.connected,
          accountLabel: stripeStatus.displayName ?? stripeStatus.accountId,
          // Stripe's own status has no "since when" — the OAuth callback
          // never recorded one — so this stays null rather than guessing.
          connectedAt: null,
        };
      }
      const row = manualByProvider.get(provider);
      const connected = row?.status === 'CONNECTED';
      return {
        provider,
        displayName: GATEWAY_DISPLAY_NAMES[provider],
        connected,
        accountLabel: null,
        connectedAt: connected ? (row?.updatedAt ?? null) : null,
      };
    });
  }

  /** Marks a manual gateway connected. Rejects STRIPE — that one goes through
   * StripeAccountController's real OAuth redirect instead. */
  async connectManual(scope: Scope, brandId: string, provider: PaymentGatewayProvider): Promise<void> {
    if (!isManualProvider(provider)) {
      throw new BadRequestException(
        `${provider} connects through its own authorisation flow, not this endpoint`,
      );
    }
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.upsert({
        where: { brandId_provider: { brandId, provider } },
        create: { brandId, provider, status: 'CONNECTED', health: 'Connected' },
        update: { status: 'CONNECTED', health: 'Connected' },
      }),
    );
  }

  /**
   * Disconnects whichever gateway is named — STRIPE included, so the Payment
   * Gateways UI can point one "Disconnect" confirmation at either kind
   * without branching on which flow originally connected it.
   */
  async disconnect(scope: Scope, brandId: string, provider: PaymentGatewayProvider): Promise<void> {
    if (!isManualProvider(provider)) {
      await this.stripe.disconnect(scope, brandId);
      return;
    }
    const result = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider },
        data: { status: 'DISCONNECTED', config: Prisma.DbNull, health: 'Disconnected' },
      }),
    );
    if (result.count === 0) {
      throw new NotFoundException(`${GATEWAY_DISPLAY_NAMES[provider]} is not connected`);
    }
  }
}
