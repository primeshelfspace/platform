import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../database/client.js';
import type { AccountingConnection, Pagination, Scope } from '@platform/kernel';
import {
  decryptCredential,
  encryptCredential,
} from '../../../../shared/common/credential-encryption.js';
import { ENV, type Env } from '../../../../shared/config/env.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { RedisService } from '../../../../shared/infra/redis/redis.service.js';
import { ZohoBooksAdapter } from '../../../../shared/adapters/accounting/zoho-books.adapter.js';

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
  /** Whether the timed pull runs at all (ZOHO_SCHEDULED_PULL_ENABLED) —
   * off means pullFrequencyMinutes has no effect and sync is webhook-driven. */
  readonly scheduledPullEnabled: boolean;
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

/** A brand whose Zoho connection is live, with what decides when it next
 * pulls. */
export interface LiveZohoConnection {
  readonly brandId: string;
  readonly lastPulledAt: Date | null;
  readonly pullFrequencyMinutes: number;
}

/**
 * Encrypted storage for the Zoho connection, plus the one piece of glue an
 * AccountingConnection always needs: a live access token. Cached per brand
 * in Redis rather than refreshed on every use — see TOKEN_CACHE_SAFETY_BUFFER_MS.
 */
@Injectable()
export class IntegrationConnectionService {
  constructor(
    private readonly prisma: PlatformPrismaService,
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
    // A reconnect always brings a new refresh token; any access token cached
    // under the previous authorization must not survive to be paired with it.
    await this.redis.cache.del(this.tokenCacheKey(brandId));
  }

  /** The connected Zoho organization's id, or null when the brand is not
   * connected — what the webhook setup URLs are built for. */
  async getZohoOrganizationId(scope: Scope, brandId: string): Promise<string | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findUnique({
        where: { brandId_provider: { brandId, provider: 'ZOHO_BOOKS' } },
        select: { status: true, config: true },
      }),
    );
    if (row?.status !== 'CONNECTED') return null;
    return (row.config as unknown as ZohoConnectionConfig | null)?.organizationId ?? null;
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
        scheduledPullEnabled: this.env.ZOHO_SCHEDULED_PULL_ENABLED,
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
      scheduledPullEnabled: this.env.ZOHO_SCHEDULED_PULL_ENABLED,
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
    // Otherwise a still-live cached access token outlives the disconnect and
    // gets handed out again if the same brand reconnects before it expires.
    await this.redis.cache.del(this.tokenCacheKey(brandId));
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
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'ZOHO_BOOKS' },
        // health alongside the cursor: a completed pull is positive evidence
        // the connection works, so it clears a stale markUnhealthy reason for
        // the same reason recordSyncRun does.
        data: { lastPulledAt: pullStartedAt, health: 'Healthy' },
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
   * Every brand with a live Zoho connection, across all tenants — what the
   * invoicing module's scheduled-sync tick needs to decide whose pull is due.
   * Cross-tenant by nature, so it runs unscoped; it returns nothing secret.
   */
  async listLiveZohoConnections(): Promise<LiveZohoConnection[]> {
    return this.prisma.withoutScope(
      'scheduled-sync: listing brands with a live Zoho connection',
      (client) =>
        client.integrationConnection.findMany({
          where: {
            provider: 'ZOHO_BOOKS',
            status: 'CONNECTED',
            encryptedCredentials: { not: null },
          },
          select: { brandId: true, lastPulledAt: true, pullFrequencyMinutes: true },
        }),
    );
  }
  /**
   * Records *why* a brand's sync is failing without stopping it.
   *
   * Deliberately touches `health` only, never `status`. Setting status to
   * UNHEALTHY would make buildAccountingConnection return null for this brand,
   * which turns every subsequent push and pull into a silent no-op with no way
   * back except a full OAuth reconnect — so a single transient auth blip would
   * permanently disable the integration. Leaving status CONNECTED keeps the
   * pipeline retrying and lets it heal on its own the moment Zoho accepts the
   * token again (recordSyncRun and recordPullRun both clear this back to
   * Healthy on the next success), while the integrations panel still shows the
   * operator exactly what Zoho said.
   */
  async markUnhealthy(scope: Scope, brandId: string, reason: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection
        .updateMany({
          where: { brandId, provider: 'ZOHO_BOOKS' },
          // Zoho's own message can be long; the column is display-oriented.
          data: { health: reason.slice(0, 500) },
        })
        // A brand that was never connected has no row to mark — nothing to do.
        .catch(() => undefined),
    );
  }

  /** Called after every successful push (ZohoSyncService.runJob). This is what
   * makes the panel's "last sync" figure mean anything: before it was wired up
   * the column was set once, at connect time, and never advanced again. Also
   * clears whatever markUnhealthy last recorded, so a recovered connection
   * stops reporting a stale failure. */
  async recordSyncRun(scope: Scope, brandId: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.updateMany({
        where: { brandId, provider: 'ZOHO_BOOKS' },
        data: { lastSyncAt: new Date(), health: 'Healthy' },
      }),
    );
  }
  /**
   * Whether any provider (Zoho, a payment gateway) is connected in scope —
   * one signal for both single-brand and All Brands mode, so the invoicing
   * dashboard's header banner doesn't need brand-by-brand connection calls of
   * its own. "In scope" is doing the real work: with brandId omitted, RLS
   * already restricts this to the readable brands, so "connected" here means
   * "at least one of my brands is".
   */
  async getConnectedSummary(
    scope: Scope,
    brandId: string | null,
  ): Promise<{ connected: boolean; lastSyncAt: Date | null }> {
    const connections = await this.prisma.withScope(scope, (tx) =>
      tx.integrationConnection.findMany({
        where: { status: 'CONNECTED', ...(brandId ? { brandId } : {}) },
        // Providers that never populate lastSyncAt (Stripe, a payment
        // gateway with nothing to "sync") must not shadow a real Zoho
        // timestamp — plain `desc` puts Postgres's default NULLS FIRST
        // ahead of any actual sync time, so the banner would (silently)
        // never show "Last synced" as long as a null-lastSyncAt connection
        // existed for the brand.
        orderBy: { lastSyncAt: { sort: 'desc', nulls: 'last' } },
        select: { provider: true, lastSyncAt: true },
        take: 1,
      }),
    );
    return { connected: connections.length > 0, lastSyncAt: connections[0]?.lastSyncAt ?? null };
  }

  /**
   * Every brand whose Zoho connection is for `organizationId`, with its
   * merchant — what the invoicing Zoho webhook needs to route an inbound
   * event. Unscoped because which brand(s) the event belongs to is exactly
   * what routing has to discover. Organization ids are not indexed (config is
   * opaque Json, and the brand count sharing one Zoho org is always small),
   * so this is a full scan of connected Zoho connections, not a hot path.
   */
  async findBrandsForZohoOrganization(
    organizationId: string,
  ): Promise<Array<{ brandId: string; merchantId: string }>> {
    const rows = await this.prisma.withoutScope(
      `zoho webhook: resolving which brand(s) organization ${organizationId} belongs to`,
      (client) =>
        client.integrationConnection.findMany({
          where: { provider: 'ZOHO_BOOKS', status: 'CONNECTED' },
          select: { brandId: true, config: true, brand: { select: { merchantId: true } } },
        }),
    );
    return rows
      .filter(
        (row) => (row.config as ZohoConnectionConfig | null)?.organizationId === organizationId,
      )
      .map((row) => ({ brandId: row.brandId, merchantId: row.brand.merchantId }));
  }
}
