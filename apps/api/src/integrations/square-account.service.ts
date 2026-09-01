import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IntegrationError, type Scope } from '@fenwick/shared';
import { decryptCredential, encryptCredential } from '../common/credential-encryption.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { signOAuthState, verifyOAuthState } from './oauth-state.js';

/** Pinned so a Square-side API change cannot silently alter response shapes
 * this service parses. Bump deliberately after checking Square's changelog. */
const SQUARE_API_VERSION = '2024-01-18';

/** read+write on payments, plus enough of the merchant's profile to show a
 * business name on the settings screen — nothing broader. */
const SQUARE_OAUTH_SCOPE = 'MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE';

export interface SquareAccountStatus {
  readonly connected: boolean;
  readonly merchantId: string | null;
  readonly businessName: string | null;
}

/** Access tokens expire (Square, unlike Stripe Connect Standard, does not
 * issue a non-expiring grant) so the refresh token travels alongside it,
 * encrypted the same way a Zoho refresh token is. */
interface SquareCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface SquareConnectConfig {
  readonly merchantId: string;
  readonly accessTokenExpiresAt: string; // ISO
}

type ConnectionRow = { status: string; encryptedCredentials: string | null; config: unknown } | null;

interface SquareTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly merchant_id: string;
  readonly expires_at: string;
}

/**
 * Square Connect (OAuth), per brand — the same shape as Stripe Connect: the
 * brand authorises the platform on Square's own consent screen instead of
 * pasting an access token.
 *
 * The one real difference from Stripe is that Square's grant expires (30
 * days) and must be refreshed with a refresh token that itself rotates on
 * every use, so — unlike Stripe Connect, which stores nothing sensitive at
 * all — this service does hold an encrypted credential per brand, refreshed
 * and re-persisted whenever getStatus finds the access token stale.
 *
 * Scope stops at "connect and show status", matching where Stripe Connect
 * itself stops today: routing an actual charge through the connected
 * merchant account is a separate, not-yet-built adapter (see
 * PaymentGatewaysService's class doc for the same honest gap on the other
 * manual gateways).
 */
@Injectable()
export class SquareAccountService {
  private readonly logger = new Logger(SquareAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  buildAuthorizeUrl(brandId: string): string {
    const clientId = this.required(this.env.SQUARE_APPLICATION_ID, 'SQUARE_APPLICATION_ID');
    const redirectUri = this.required(
      this.env.SQUARE_CONNECT_REDIRECT_URI,
      'SQUARE_CONNECT_REDIRECT_URI',
    );

    const url = new URL(`${this.baseUrl()}/oauth2/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', SQUARE_OAUTH_SCOPE);
    url.searchParams.set('session', 'false');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', signOAuthState(brandId, 'square', this.env.SESSION_SECRET));
    return url.toString();
  }

  verifyCallbackState(state: string): { brandId: string } | null {
    return verifyOAuthState(state, 'square', this.env.SESSION_SECRET);
  }

  async completeConnection(scope: Scope, brandId: string, code: string): Promise<void> {
    const redirectUri = this.required(
      this.env.SQUARE_CONNECT_REDIRECT_URI,
      'SQUARE_CONNECT_REDIRECT_URI',
    );

    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    await this.persistToken(scope, brandId, token);
    this.logger.log(`brand ${brandId} connected Square merchant ${token.merchant_id}`);
  }

  async getStatus(scope: Scope, brandId: string): Promise<SquareAccountStatus> {
    const row = await this.findConnectionScoped(scope, brandId);
    if (!row || row.status !== 'CONNECTED' || !row.encryptedCredentials) {
      return { connected: false, merchantId: null, businessName: null };
    }
    const config = row.config as unknown as SquareConnectConfig;

    try {
      const accessToken = await this.freshAccessToken(scope, brandId, row);
      const business = await this.fetchBusinessName(config.merchantId, accessToken);
      return { connected: true, merchantId: config.merchantId, businessName: business };
    } catch (error) {
      this.logger.warn(
        `could not verify Square merchant ${config.merchantId} for brand ${brandId}: ${(error as Error).message}`,
      );
      return { connected: false, merchantId: config.merchantId, businessName: null };
    }
  }

  /**
   * Revokes every token issued to this platform for the merchant, then
   * clears the row. Order matches Stripe's disconnect for the same reason: if
   * the revoke fails, the stored row must keep saying CONNECTED, because the
   * authorisation genuinely still exists.
   */
  async disconnect(scope: Scope, brandId: string): Promise<void> {
    const row = await this.findConnectionScoped(scope, brandId);

    if (row?.encryptedCredentials) {
      try {
        const { accessToken } = this.decryptCredentials(row.encryptedCredentials);
        await this.revokeToken(accessToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not.*found|already.*revoked|invalid/i.test(message)) {
          throw this.wrap(error, 'could not disconnect the Square account');
        }
        this.logger.warn(`Square token for brand ${brandId} was already revoked: ${message}`);
      }
    }

    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'SQUARE' },
        data: {
          status: 'DISCONNECTED',
          encryptedCredentials: null,
          config: Prisma.DbNull,
          health: 'Disconnected',
        },
      }),
    );
  }

  /** Refreshes and re-persists the access token when it is within five
   * minutes of expiring, mirroring the safety buffer Zoho's cached-token path
   * uses for the same reason: never hand out a token that could expire
   * mid-request. */
  private async freshAccessToken(scope: Scope, brandId: string, row: ConnectionRow): Promise<string> {
    if (!row?.encryptedCredentials) throw new Error('no Square credentials stored');
    const config = row.config as unknown as SquareConnectConfig;
    const { accessToken, refreshToken } = this.decryptCredentials(row.encryptedCredentials);

    const expiresInMs = new Date(config.accessTokenExpiresAt).getTime() - Date.now();
    if (expiresInMs > 5 * 60 * 1000) return accessToken;

    const refreshed = await this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    await this.persistToken(scope, brandId, refreshed);
    return refreshed.access_token;
  }

  private async persistToken(scope: Scope, brandId: string, token: SquareTokenResponse): Promise<void> {
    const credentials: SquareCredentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    };
    const config: SquareConnectConfig = {
      merchantId: token.merchant_id,
      accessTokenExpiresAt: token.expires_at,
    };
    const encrypted = encryptCredential(JSON.stringify(credentials), this.env.CREDENTIAL_ENCRYPTION_KEY);

    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.upsert({
        where: { brandId_provider: { brandId, provider: 'SQUARE' } },
        create: {
          brandId,
          provider: 'SQUARE',
          status: 'CONNECTED',
          encryptedCredentials: encrypted,
          config: config as unknown as Prisma.InputJsonValue,
          health: 'Connected',
        },
        update: {
          status: 'CONNECTED',
          encryptedCredentials: encrypted,
          config: config as unknown as Prisma.InputJsonValue,
          health: 'Connected',
        },
      }),
    );
  }

  private async requestToken(
    body: Record<string, string>,
  ): Promise<SquareTokenResponse> {
    const clientId = this.required(this.env.SQUARE_APPLICATION_ID, 'SQUARE_APPLICATION_ID');
    const clientSecret = this.required(this.env.SQUARE_APPLICATION_SECRET, 'SQUARE_APPLICATION_SECRET');

    const response = await fetch(`${this.baseUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_API_VERSION },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
    });

    const payload = (await response.json().catch(() => null)) as
      | SquareTokenResponse
      | { error_description?: string; message?: string }
      | null;

    if (!response.ok || !payload || !('access_token' in payload)) {
      const message =
        (payload && 'error_description' in payload && payload.error_description) ||
        (payload && 'message' in payload && payload.message) ||
        `Square returned ${response.status}`;
      throw new IntegrationError({
        message: 'could not complete the Square connection',
        errorClass: response.status >= 500 ? 'TRANSIENT' : 'PERMANENT',
        provider: 'square',
        providerMessage: message,
        httpStatus: response.status,
      });
    }

    return payload;
  }

  private async revokeToken(accessToken: string): Promise<void> {
    const clientId = this.required(this.env.SQUARE_APPLICATION_ID, 'SQUARE_APPLICATION_ID');
    const clientSecret = this.required(this.env.SQUARE_APPLICATION_SECRET, 'SQUARE_APPLICATION_SECRET');

    const response = await fetch(`${this.baseUrl()}/oauth2/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_API_VERSION,
        Authorization: `Client ${clientSecret}`,
      },
      body: JSON.stringify({ client_id: clientId, access_token: accessToken }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Square revoke returned ${response.status}: ${body}`);
    }
  }

  private async fetchBusinessName(merchantId: string, accessToken: string): Promise<string | null> {
    const response = await fetch(`${this.baseUrl()}/v2/merchants/${merchantId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_API_VERSION },
    });
    if (!response.ok) {
      throw new Error(`Square merchant lookup returned ${response.status}`);
    }
    const body = (await response.json()) as { merchant?: { business_name?: string } };
    return body.merchant?.business_name ?? null;
  }

  private baseUrl(): string {
    return this.env.SQUARE_ENVIRONMENT === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
  }

  private findConnectionScoped(scope: Scope, brandId: string): Promise<ConnectionRow> {
    return this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'SQUARE' } },
        select: { status: true, encryptedCredentials: true, config: true },
      }),
    );
  }

  private decryptCredentials(encrypted: string): SquareCredentials {
    return JSON.parse(
      decryptCredential(encrypted, this.env.CREDENTIAL_ENCRYPTION_KEY),
    ) as SquareCredentials;
  }

  private required(value: string | undefined, key: string): string {
    if (!value) {
      throw new IntegrationError({
        message: `${key} is not configured on this deployment`,
        errorClass: 'VALIDATION',
        provider: 'square',
      });
    }
    return value;
  }

  private wrap(error: unknown, message: string): IntegrationError {
    if (error instanceof IntegrationError) return error;
    return new IntegrationError({
      message,
      errorClass: 'PERMANENT',
      provider: 'square',
      cause: error,
    });
  }
}
