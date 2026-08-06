import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AccountingConnection, Scope } from '@fenwick/shared';
import { decryptCredential, encryptCredential } from '../common/credential-encryption.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';

interface CachedAccessToken {
  readonly accessToken: string;
  readonly expiresAt: string; // ISO — Redis stores JSON, Dates don't round-trip
}

/** Refreshed tokens are cached until 2 minutes before they actually expire —
 * short enough that a stale token is never handed out, long enough that a
 * backfill queuing hundreds of jobs shares one token instead of each job
 * independently hitting Zoho's OAuth server (that storm is what triggers
 * Zoho's own rate limiting — see the incident this comment is next to). */
const TOKEN_CACHE_SAFETY_BUFFER_MS = 2 * 60 * 1000;

export interface ZohoCredentials {
  readonly refreshToken: string;
  readonly apiDomain: string;
}

export interface ZohoConnectionConfig {
  readonly organizationId: string;
  readonly organizationName: string;
}

export interface ZohoConnectionStatus {
  readonly connected: boolean;
  readonly organizationName: string | null;
  readonly lastSyncAt: Date | null;
  readonly lastPulledAt: Date | null;
  readonly health: string | null;
  readonly pullFrequencyMinutes: number;
  readonly customerSyncEnabled: boolean;
  readonly invoiceSyncEnabled: boolean;
}

export interface ZohoSyncFlags {
  readonly customerSyncEnabled: boolean;
  readonly invoiceSyncEnabled: boolean;
}

/** Matches the column defaults exactly — what a brand that has never
 * configured these settings is actually running under. */
const DEFAULT_SYNC_SETTINGS = {
  pullFrequencyMinutes: 15,
  customerSyncEnabled: true,
  invoiceSyncEnabled: true,
} as const;

export interface ZohoActivityEntry {
  readonly direction: 'PUSH' | 'PULL';
  readonly objectType: string;
  readonly objectId: string | null;
  readonly status: string;
  readonly errorClass: string | null;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

/**
 * Encrypted storage for the Zoho connection, plus the one piece of glue an
 * AccountingConnection always needs: a live access token. Cached per brand
 * in Redis rather than refreshed on every use — see TOKEN_CACHE_SAFETY_BUFFER_MS.
 */
@Injectable()
export class IntegrationConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly zoho: ZohoBooksAdapter,
    private readonly redis: RedisService,
  ) {}

  async saveZohoConnection(
    scope: Scope,
    brandId: string,
    credentials: ZohoCredentials,
    config: ZohoConnectionConfig,
  ): Promise<void> {
    const encrypted = encryptCredential(
      JSON.stringify(credentials),
      this.env.CREDENTIAL_ENCRYPTION_KEY,
    );
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.upsert({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        create: {
          brandId,
          provider: 'ZOHO_BOOKS',
          status: 'CONNECTED',
          encryptedCredentials: encrypted,
          config: config as unknown as Prisma.InputJsonValue,
          lastSyncAt: new Date(),
          health: 'Healthy',
        },
        update: {
          status: 'CONNECTED',
          encryptedCredentials: encrypted,
          config: config as unknown as Prisma.InputJsonValue,
          health: 'Healthy',
        },
      }),
    );
  }

  async getStatus(scope: Scope, brandId: string): Promise<ZohoConnectionStatus> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
      }),
    );
    if (!row) {
      return {
        connected: false,
        organizationName: null,
        lastSyncAt: null,
        lastPulledAt: null,
        health: null,
        ...DEFAULT_SYNC_SETTINGS,
      };
    }
    const config = row.config as unknown as ZohoConnectionConfig | null;
    return {
      // A CONNECTED status with no stored credentials cannot actually reach
      // Zoho — buildAccountingConnection applies the same requirement — so
      // it must not be reported as connected here either.
      connected: row.status === 'CONNECTED' && Boolean(row.encryptedCredentials),
      organizationName: config?.organizationName ?? null,
      lastSyncAt: row.lastSyncAt,
      lastPulledAt: row.lastPulledAt,
      health: row.health,
      pullFrequencyMinutes: row.pullFrequencyMinutes,
      customerSyncEnabled: row.customerSyncEnabled,
      invoiceSyncEnabled: row.invoiceSyncEnabled,
    };
  }

  /**
   * FR-ZHO-030's settings panel: every field optional and applied the moment
   * it changes (see zohoSyncSettingsSchema) — there is no separate save step
   * for the caller to batch into. NotFoundException rather than a silent
   * upsert: these settings modify a connection, and a brand with no Zoho
   * connection yet has nothing here to configure.
   */
  async updateSyncSettings(
    scope: Scope,
    brandId: string,
    patch: {
      readonly pullFrequencyMinutes?: number;
      readonly customerSyncEnabled?: boolean;
      readonly invoiceSyncEnabled?: boolean;
    },
  ): Promise<ZohoConnectionStatus> {
    const result = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'ZOHO_BOOKS' },
        data: patch,
      }),
    );
    if (result.count === 0) throw new NotFoundException('brand is not connected to Zoho');
    return this.getStatus(scope, brandId);
  }

  /**
   * Zoho, unlike Stripe, has no adapter-level revoke call today — there is no
   * refresh-token revocation endpoint wired up (TDD-001 leaves this as a
   * known gap). This still fully disconnects on this platform's side: the
   * credentials are gone and nothing pushes or pulls for this brand again.
   * A user who wants Zoho itself to forget this platform can revoke it from
   * their own Zoho account's connected-apps settings.
   */
  async disconnectZoho(scope: Scope, brandId: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'ZOHO_BOOKS' },
        data: {
          status: 'DISCONNECTED',
          encryptedCredentials: null,
          config: Prisma.DbNull,
          health: 'Disconnected',
        },
      }),
    );
  }

  /** The one thing ZohoSyncService's push methods need to decide whether to
   * run at all — kept separate from buildAccountingConnection so a caller
   * that only needs the gate doesn't also pay for a token refresh. */
  async getSyncFlags(scope: Scope, brandId: string): Promise<ZohoSyncFlags | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        select: { customerSyncEnabled: true, invoiceSyncEnabled: true },
      }),
    );
    return row;
  }

  /** Null means "never pulled" — the caller treats that as "fetch everything". */
  async getLastPulledAt(scope: Scope, brandId: string): Promise<Date | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        select: { lastPulledAt: true },
      }),
    );
    return row?.lastPulledAt ?? null;
  }

  /** Stamped with when the pull *started*, not the newest record seen —
   * see the migration comment on IntegrationConnection.lastPulledAt. */
  async recordPullRun(scope: Scope, brandId: string, pullStartedAt: Date): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.update({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        data: { lastPulledAt: pullStartedAt },
      }),
    );
  }

  /**
   * A ready-to-use AccountingConnection for one call. Returns null if the
   * brand has never connected — the caller decides whether that is "nothing
   * to do" or an error.
   */
  async buildAccountingConnection(
    scope: Scope,
    brandId: string,
  ): Promise<AccountingConnection | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
      }),
    );
    if (!row?.encryptedCredentials || row.status !== 'CONNECTED') return null;

    const credentials = JSON.parse(
      decryptCredential(row.encryptedCredentials, this.env.CREDENTIAL_ENCRYPTION_KEY),
    ) as ZohoCredentials;
    const config = row.config as unknown as ZohoConnectionConfig;

    const cached = await this.redis.getJson<CachedAccessToken>(this.tokenCacheKey(brandId));
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return {
        brandId,
        organisationId: config.organizationId,
        accessToken: cached.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: new Date(cached.expiresAt),
      };
    }

    const { accessToken, expiresAt } = await this.zoho.refreshAccessToken(credentials.refreshToken);
    const ttlSeconds = Math.max(
      60,
      Math.round((expiresAt.getTime() - TOKEN_CACHE_SAFETY_BUFFER_MS - Date.now()) / 1000),
    );
    await this.redis.setJson(
      this.tokenCacheKey(brandId),
      { accessToken, expiresAt: expiresAt.toISOString() } satisfies CachedAccessToken,
      ttlSeconds,
    );

    return {
      brandId,
      organisationId: config.organizationId,
      accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt,
    };
  }

  private tokenCacheKey(brandId: string): string {
    return `zoho:access-token:${brandId}`;
  }

  /**
   * FR-ZHO-020/021, and the direct answer to "is this actually doing
   * anything real": every push and pull attempt records a SyncJob row with
   * the provider's own verbatim error, not a paraphrase. This surfaces the
   * last N of them so that is visible on the page itself, not just in a
   * database query someone has to ask for.
   */
  async getRecentActivity(scope: Scope, brandId: string, limit = 15): Promise<ZohoActivityEntry[]> {
    const rows = await this.prisma.withScope(scope, (tx) =>
      tx.syncJob.findMany({
        where: { brandId, provider: 'ZOHO_BOOKS' },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    );
    return rows.map((row) => ({
      direction: row.direction,
      objectType: row.objectType,
      objectId: row.objectId,
      status: row.status,
      errorClass: row.errorClass,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    }));
  }

  async markUnhealthy(scope: Scope, brandId: string, reason: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection
        .update({
          where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
          data: { status: 'UNHEALTHY', health: reason },
        })
        // A brand that was never connected has no row to mark — nothing to do.
        .catch(() => undefined),
    );
  }

  async recordSyncRun(scope: Scope, brandId: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.update({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        data: { lastSyncAt: new Date(), health: 'Healthy' },
      }),
    );
  }
}
