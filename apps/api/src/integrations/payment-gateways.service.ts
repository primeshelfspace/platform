import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentGatewayProvider, Scope } from '@fenwick/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { AuthorizeNetAccountService } from './authorize-net-account.service.js';
import { SquareAccountService } from './square-account.service.js';
import { StripeAccountService } from './stripe-account.service.js';

/** The one gateway left with no credential handshake behind it — connecting
 * it is just recording the brand's choice (see class doc), because it needs
 * PayPal Partner approval this platform does not have yet. STRIPE, SQUARE and
 * AUTHORIZE_NET are excluded: each completes a real connection of its own
 * (OAuth for the first two, a verified credential paste for the third) and is
 * handled by its own service instead. */
const MANUAL_PROVIDERS = ['PAYPAL'] as const;
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
 * Authorize.net side by side. Stripe, Square and Authorize.net each complete
 * a real connection of their own (StripeAccountService and
 * SquareAccountService's OAuth, AuthorizeNetAccountService's verified
 * credential paste); PayPal alone has no such integration built yet — it
 * needs PayPal Partner approval this platform does not have — so connecting
 * it only records that the brand picked it. That is the same honest gap
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
    private readonly square: SquareAccountService,
    private readonly authorizeNet: AuthorizeNetAccountService,
  ) {}

  async list(scope: Scope, brandId: string): Promise<PaymentGatewaySummary[]> {
    const [stripeStatus, squareStatus, authorizeNetStatus, manualRows] = await Promise.all([
      this.stripe.getStatus(scope, brandId),
      this.square.getStatus(scope, brandId),
      this.authorizeNet.getStatus(scope, brandId),
      this.prisma.withScope(scope, (tx) =>
        tx.integrationConnection.findMany({
          where: { brandId, provider: { in: [...MANUAL_PROVIDERS] } },
          select: { provider: true, status: true, updatedAt: true },
        }),
      ),
    ]);

    const manualByProvider = new Map(manualRows.map((row) => [row.provider, row]));

    return (['STRIPE', 'PAYPAL', 'SQUARE', 'AUTHORIZE_NET'] as const).map((provider) => {
      if (provider === 'STRIPE') {
        return {
          provider,
          displayName: GATEWAY_DISPLAY_NAMES.STRIPE,
          connected: stripeStatus.connected,
          accountLabel: stripeStatus.displayName ?? stripeStatus.accountId,
          // Neither Stripe's nor Square's status carries a "since when" — the
          // OAuth callback never recorded one — so this stays null rather
          // than guessing.
          connectedAt: null,
        };
      }
      if (provider === 'SQUARE') {
        return {
          provider,
          displayName: GATEWAY_DISPLAY_NAMES.SQUARE,
          connected: squareStatus.connected,
          accountLabel: squareStatus.businessName ?? squareStatus.merchantId,
          connectedAt: null,
        };
      }
      if (provider === 'AUTHORIZE_NET') {
        return {
          provider,
          displayName: GATEWAY_DISPLAY_NAMES.AUTHORIZE_NET,
          connected: authorizeNetStatus.connected,
          accountLabel: authorizeNetStatus.apiLoginIdLast4
            ? `API Login •••• ${authorizeNetStatus.apiLoginIdLast4}`
            : null,
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

  /** Marks PayPal connected. Rejects every other provider — those go through
   * their own controller's real connect flow instead. */
  async connectManual(
    scope: Scope,
    brandId: string,
    provider: PaymentGatewayProvider,
  ): Promise<void> {
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
   * Disconnects whichever gateway is named — every provider included, so the
   * Payment Gateways UI can point one "Disconnect" confirmation at any of
   * them without branching on which flow originally connected it.
   */
  async disconnect(scope: Scope, brandId: string, provider: PaymentGatewayProvider): Promise<void> {
    if (provider === 'STRIPE') {
      await this.stripe.disconnect(scope, brandId);
      return;
    }
    if (provider === 'SQUARE') {
      await this.square.disconnect(scope, brandId);
      return;
    }
    if (provider === 'AUTHORIZE_NET') {
      await this.authorizeNet.disconnect(scope, brandId);
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
