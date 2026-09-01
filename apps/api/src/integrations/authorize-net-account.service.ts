import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IntegrationError, type AuthorizeNetConnectInput, type Scope } from '@fenwick/shared';
import { encryptCredential } from '../common/credential-encryption.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface AuthorizeNetStatus {
  readonly connected: boolean;
  readonly apiLoginIdLast4: string | null;
  readonly environment: 'sandbox' | 'production' | null;
}

interface AuthorizeNetCredentials {
  readonly apiLoginId: string;
  readonly transactionKey: string;
}

interface AuthorizeNetConfig {
  readonly environment: 'sandbox' | 'production';
  /** Last 4 of the API Login ID, for display — the full value lives only in
   * encryptedCredentials alongside the Transaction Key. */
  readonly apiLoginIdLast4: string;
}

interface AuthenticateTestResponse {
  readonly messages: {
    readonly resultCode: 'Ok' | 'Error';
    readonly message: ReadonlyArray<{ readonly code: string; readonly text: string }>;
  };
}

/**
 * Authorize.net, per brand. Unlike Stripe and Square, Authorize.net offers no
 * OAuth consent screen for a third-party platform — a merchant's only
 * credential is its API Login ID and Transaction Key, generated from its own
 * Authorize.net Merchant Interface. So "Connect" here means the brand pastes
 * those two values in rather than authorising a redirect, and this service's
 * job is to verify them against Authorize.net before ever storing them.
 *
 * That verification is what `authenticateTestRequest` is for: it is
 * Authorize.net's own no-op transaction type, built specifically to validate
 * a merchantAuthentication block without creating a real transaction — the
 * same reason a paste-your-keys form beats blindly trusting user input.
 *
 * The Transaction Key is encrypted at rest the same way a Zoho refresh token
 * is (see credential-encryption.ts); the API Login ID travels alongside it
 * in the same encrypted blob since Authorize.net's API needs both together,
 * and only its last 4 digits are kept in `config` for display.
 */
@Injectable()
export class AuthorizeNetAccountService {
  private readonly logger = new Logger(AuthorizeNetAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async connect(scope: Scope, brandId: string, input: AuthorizeNetConnectInput): Promise<void> {
    await this.verifyCredentials(input);

    const credentials: AuthorizeNetCredentials = {
      apiLoginId: input.apiLoginId,
      transactionKey: input.transactionKey,
    };
    const config: AuthorizeNetConfig = {
      environment: input.environment,
      apiLoginIdLast4: input.apiLoginId.slice(-4),
    };
    const encrypted = encryptCredential(
      JSON.stringify(credentials),
      this.env.CREDENTIAL_ENCRYPTION_KEY,
    );

    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.upsert({
        where: { brandId_provider: { brandId, provider: 'AUTHORIZE_NET' } },
        create: {
          brandId,
          provider: 'AUTHORIZE_NET',
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
    this.logger.log(`brand ${brandId} connected Authorize.net (${input.environment})`);
  }

  async getStatus(scope: Scope, brandId: string): Promise<AuthorizeNetStatus> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'AUTHORIZE_NET' } },
        select: { status: true, encryptedCredentials: true, config: true },
      }),
    );
    if (!row || row.status !== 'CONNECTED' || !row.encryptedCredentials) {
      return { connected: false, apiLoginIdLast4: null, environment: null };
    }
    const config = row.config as unknown as AuthorizeNetConfig;
    return { connected: true, apiLoginIdLast4: config.apiLoginIdLast4, environment: config.environment };
  }

  /**
   * There is no remote token to revoke — Authorize.net issues no OAuth grant
   * to withdraw, the same honest gap Zoho's own disconnect calls out for the
   * same reason. This still fully disconnects on this platform's side.
   */
  async disconnect(scope: Scope, brandId: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'AUTHORIZE_NET' },
        data: {
          status: 'DISCONNECTED',
          encryptedCredentials: null,
          config: Prisma.DbNull,
          health: 'Disconnected',
        },
      }),
    );
  }

  private async verifyCredentials(input: AuthorizeNetConnectInput): Promise<void> {
    const url =
      input.environment === 'production'
        ? 'https://api.authorize.net/xml/v1/request.api'
        : 'https://apitest.authorize.net/xml/v1/request.api';

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authenticateTestRequest: {
            merchantAuthentication: { name: input.apiLoginId, transactionKey: input.transactionKey },
          },
        }),
      });
    } catch (cause) {
      throw new IntegrationError({
        message: 'could not reach Authorize.net to verify these credentials',
        errorClass: 'TRANSIENT',
        provider: 'authorize_net',
        cause,
      });
    }

    // Authorize.net's JSON API prefixes every response with a UTF-8 BOM.
    const bodyText = await response.text();
    const raw = bodyText.charCodeAt(0) === 0xfeff ? bodyText.slice(1) : bodyText;
    let payload: AuthenticateTestResponse;
    try {
      payload = JSON.parse(raw) as AuthenticateTestResponse;
    } catch (cause) {
      throw new IntegrationError({
        message: 'Authorize.net returned an unreadable response',
        errorClass: 'TRANSIENT',
        provider: 'authorize_net',
        httpStatus: response.status,
        cause,
      });
    }

    if (payload.messages.resultCode !== 'Ok') {
      const detail = payload.messages.message[0];
      throw new IntegrationError({
        message: 'Authorize.net rejected these credentials',
        errorClass: 'VALIDATION',
        provider: 'authorize_net',
        providerMessage: detail?.text ?? 'invalid API Login ID or Transaction Key',
        providerCode: detail?.code,
      });
    }
  }
}
