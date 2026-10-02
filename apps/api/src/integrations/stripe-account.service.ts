import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { IntegrationError, type Scope } from '@sugrpay/shared';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { signOAuthState, verifyOAuthState } from './oauth-state.js';

export const STRIPE_API_VERSION = '2025-02-24.acacia';

export interface StripeAccountStatus {
  readonly connected: boolean;
  /** The connected account id (acct_…). Not a secret — it travels in the
   * client-side Elements options and in every webhook payload. */
  readonly accountId: string | null;
  /** Whatever Stripe knows this business as, for display. Null until the brand
   * finishes Stripe's own onboarding, which can outlast the OAuth redirect. */
  readonly displayName: string | null;
  /** False while Stripe is still collecting details from the brand — the
   * account is linked but cannot accept a live charge yet. */
  readonly chargesEnabled: boolean;
}

/** The whole of what is stored per brand. Note what is absent: no key, no
 * token, nothing that needs encrypting. */
interface StripeConnectConfig {
  readonly accountId: string;
}

type ConnectionRow = { status: string; config: unknown } | null;

/**
 * Stripe Connect (Standard), per brand.
 *
 * The brand authorises the platform through Stripe's own consent screen rather
 * than pasting API keys. What comes back is an account id (acct_…) and nothing
 * else worth protecting: every call the platform makes on that brand's behalf
 * goes out under the PLATFORM's secret key with `stripeAccount` set, so this
 * service stores no per-brand credential at all.
 *
 * That is the substantive difference from the arrangement it replaces, which
 * held each brand's live secret key encrypted at rest. A leak there exposed
 * unrestricted access to the brand's entire Stripe account, including business
 * that never touched this platform. Here the brand grants a scoped
 * authorisation it can revoke from its own dashboard at any time, and
 * `encryptedCredentials` stays null on every STRIPE row.
 */
@Injectable()
export class StripeAccountService {
  private readonly logger = new Logger(StripeAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Where to send the brand admin to authorise. The `state` is HMAC-signed
   * with the provider baked in — Stripe's redirect back carries no session, so
   * this is the only thing tying the callback to the brand that began it.
   */
  buildAuthorizeUrl(brandId: string): string {
    const clientId = this.required(this.env.STRIPE_CONNECT_CLIENT_ID, 'STRIPE_CONNECT_CLIENT_ID');
    const redirectUri = this.required(
      this.env.STRIPE_CONNECT_REDIRECT_URI,
      'STRIPE_CONNECT_REDIRECT_URI',
    );

    const url = new URL('https://connect.stripe.com/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    // read_write: the platform creates PaymentIntents and refunds on the
    // brand's account. read_only could not take a payment at all.
    url.searchParams.set('scope', 'read_write');
    url.searchParams.set('state', signOAuthState(brandId, 'stripe', this.env.SESSION_SECRET));
    return url.toString();
  }

  /** Verifies the returned state and yields the brand that started the flow. */
  verifyCallbackState(state: string): { brandId: string } | null {
    return verifyOAuthState(state, 'stripe', this.env.SESSION_SECRET);
  }

  /**
   * Exchanges the authorization code for the connected account id and records
   * it. Deliberately discards the `access_token` Stripe also returns: with
   * `stripeAccount` set per request the platform key is sufficient, so keeping
   * a second long-lived credential would recreate precisely the storage risk
   * this flow exists to remove.
   */
  async completeConnection(scope: Scope, brandId: string, code: string): Promise<void> {
    let token: Stripe.OAuthToken;
    try {
      token = await this.platformClient().oauth.token({ grant_type: 'authorization_code', code });
    } catch (error) {
      throw this.wrap(error, 'could not complete the Stripe connection');
    }

    const accountId = token.stripe_user_id;
    if (!accountId) {
      throw new IntegrationError({
        message: 'Stripe returned no account id for this authorization',
        errorClass: 'PERMANENT',
        provider: 'stripe',
      });
    }

    const config: StripeConnectConfig = { accountId };
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.upsert({
        where: { brandId_provider: { brandId, provider: 'STRIPE' } },
        create: {
          brandId,
          provider: 'STRIPE',
          status: 'CONNECTED',
          encryptedCredentials: null,
          config: config as unknown as Prisma.InputJsonValue,
          health: 'Connected',
        },
        update: {
          status: 'CONNECTED',
          // Clears any key left behind by the previous paste-your-keys flow.
          encryptedCredentials: null,
          config: config as unknown as Prisma.InputJsonValue,
          health: 'Connected',
        },
      }),
    );
    this.logger.log(`brand ${brandId} connected Stripe account ${accountId}`);
  }

  /**
   * Status for the settings screen. Asks Stripe rather than trusting the stored
   * row, because a brand can revoke from its own dashboard without telling us —
   * a row saying CONNECTED is a claim, not evidence.
   */
  async getStatus(scope: Scope, brandId: string): Promise<StripeAccountStatus> {
    const accountId = this.accountIdOf(await this.findConnectionScoped(scope, brandId));
    if (!accountId) {
      return { connected: false, accountId: null, displayName: null, chargesEnabled: false };
    }

    try {
      const account = await this.platformClient().accounts.retrieve(accountId);
      return {
        connected: true,
        accountId,
        displayName:
          account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
        chargesEnabled: account.charges_enabled,
      };
    } catch (error) {
      // Revoked at Stripe, or Stripe unreachable. Report it as unusable rather
      // than failing the whole settings page.
      this.logger.warn(
        `could not retrieve Stripe account ${accountId} for brand ${brandId}: ${(error as Error).message}`,
      );
      return { connected: false, accountId, displayName: null, chargesEnabled: false };
    }
  }

  /**
   * Revokes the platform's authorisation at Stripe, then clears the row. Order
   * matters: if the revoke fails, the row stays, so the UI keeps showing a
   * connection that genuinely still exists rather than stranding one that could
   * then only be cleaned up from Stripe's dashboard.
   */
  async disconnect(scope: Scope, brandId: string): Promise<void> {
    const accountId = this.accountIdOf(await this.findConnectionScoped(scope, brandId));

    if (accountId) {
      try {
        await this.platformClient().oauth.deauthorize({
          client_id: this.required(this.env.STRIPE_CONNECT_CLIENT_ID, 'STRIPE_CONNECT_CLIENT_ID'),
          stripe_user_id: accountId,
        });
      } catch (error) {
        // Already revoked on Stripe's side is success, not failure — the goal
        // state (this platform holds no access) is what is being asserted.
        const message = error instanceof Error ? error.message : String(error);
        if (!/not connected|does not have access|No such application/i.test(message)) {
          throw this.wrap(error, 'could not disconnect the Stripe account');
        }
        this.logger.warn(`Stripe account ${accountId} was already revoked: ${message}`);
      }
    }

    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'STRIPE' },
        data: { status: 'DISCONNECTED', config: Prisma.DbNull, health: 'Disconnected' },
      }),
    );
  }

  /**
   * The gateway's own read path: which connected account a payment belongs to.
   * Unscoped on purpose — this runs from the anonymous public payment page (no
   * session, so no scope exists yet), keyed by a brandId the caller already
   * resolved through *its* own trusted path (an invoice row's brandId). Same
   * justification as every other withoutScope call site here.
   */
  async getAccountIdForBrand(brandId: string): Promise<string | null> {
    const row = await this.prisma.withoutScope(
      "resolving a brand's Stripe account to process a payment",
      (client) =>
        client.integrationConnection.findUnique({
          where: { brandId_provider: { brandId, provider: 'STRIPE' } },
          select: { status: true, config: true },
        }),
    );
    return this.accountIdOf(row);
  }

  /**
   * The reverse lookup, for the webhook: a connected-account event carries
   * `account: acct_…` and nothing else identifying the tenant. Unscoped for the
   * same reason the public-token lookup is — which brand this belongs to is
   * precisely what it exists to discover.
   */
  async findBrandIdByAccountId(accountId: string): Promise<string | null> {
    const rows = await this.prisma.withoutScope(
      'webhook resolution by Stripe account id — the scope this event belongs to is not yet known',
      (client) =>
        client.integrationConnection.findMany({
          where: { provider: 'STRIPE', status: 'CONNECTED' },
          select: { brandId: true, status: true, config: true },
        }),
    );
    return rows.find((row) => this.accountIdOf(row) === accountId)?.brandId ?? null;
  }

  /** The platform's own Stripe client. Every connected-account call reuses this
   * and passes `{ stripeAccount }` per request. */
  platformClient(): Stripe {
    return new Stripe(this.required(this.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  /** Safe to hand to the browser; publishable keys are not secret. */
  platformPublishableKey(): string | null {
    return this.env.STRIPE_PUBLISHABLE_KEY ?? null;
  }

  private findConnectionScoped(scope: Scope, brandId: string): Promise<ConnectionRow> {
    return this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'STRIPE' } },
        select: { status: true, config: true },
      }),
    );
  }

  private accountIdOf(row: ConnectionRow): string | null {
    if (!row || row.status !== 'CONNECTED') return null;
    const config = row.config as StripeConnectConfig | null;
    return config?.accountId ?? null;
  }

  private required(value: string | undefined, key: string): string {
    if (!value) {
      throw new IntegrationError({
        message: `${key} is not configured on this deployment`,
        errorClass: 'VALIDATION',
        provider: 'stripe',
      });
    }
    return value;
  }

  private wrap(error: unknown, message: string): IntegrationError {
    if (error instanceof Stripe.errors.StripeError) {
      return new IntegrationError({
        message,
        errorClass:
          error instanceof Stripe.errors.StripeConnectionError ? 'TRANSIENT' : 'PERMANENT',
        provider: 'stripe',
        providerMessage: error.message,
        providerCode: error.code,
        httpStatus: error.statusCode,
        cause: error,
      });
    }
    return new IntegrationError({
      message,
      errorClass: 'PERMANENT',
      provider: 'stripe',
      cause: error,
    });
  }
}
