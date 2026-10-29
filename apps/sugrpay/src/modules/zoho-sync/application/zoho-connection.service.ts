import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../database/client.js';
import type { AccountingConnection, Pagination, Scope } from '@platform/kernel';
import {
  ENV,
  RedisService,
  decryptCredential,
  encryptCredential,
  type Env,
} from '@platform/server';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { ZohoBooksAdapter } from '../../../adapters/accounting/zoho-books.adapter.js';
import type { ZohoWebhookDelivery } from './zoho-webhook.service.js';

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

/** How long one job may hold the brand's refresh lock, and how long the
 * others wait (polling the cache) for its token before refreshing anyway. */
const TOKEN_REFRESH_LOCK_SECONDS = 30;
const TOKEN_REFRESH_WAIT_MS = 10_000;
const TOKEN_REFRESH_POLL_MS = 250;

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
  /** Whether timed pulls may run on this server at all
   * (ZOHO_SCHEDULED_PULL_ENABLED, an emergency switch, on by default). Off,
   * every brand is Real-time whatever pullFrequencyMinutes says. */
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
  pullFrequencyMinutes: 0,
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
 * Encrypted storage for a brand's Zoho Books connection (Sugrpay's own
 * zoho_connection table — Zoho sync is Sugrpay-only), plus the one piece of glue an
 * AccountingConnection always needs: a live access token. Cached per brand
 * in Redis rather than refreshed on every use — see TOKEN_CACHE_SAFETY_BUFFER_MS.
 */
@Injectable()
export class ZohoConnectionService {
  constructor(
    private readonly prisma: InvoicingPrismaService,
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
      tx.zohoConnection.upsert({
        where: { brandId },
        create: {
          brandId,
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
      tx.zohoConnection.findUnique({
        where: { brandId },
        select: { status: true, config: true },
      }),
    );
    if (row?.status !== 'CONNECTED') return null;
    return (row.config as unknown as ZohoConnectionConfig | null)?.organizationId ?? null;
  }

  async getStatus(scope: Scope, brandId: string): Promise<ZohoConnectionStatus> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.zohoConnection.findUnique({
        where: { brandId },
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
      tx.zohoConnection.updateMany({
        where: { brandId },
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
      tx.zohoConnection.updateMany({
        where: { brandId },
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
      tx.zohoConnection.findUnique({
        where: { brandId },
        select: { customerSyncEnabled: true, invoiceSyncEnabled: true },
      }),
    );
    return row;
  }

  /** Null means "never pulled" — the caller treats that as "fetch everything". */
  async getLastPulledAt(scope: Scope, brandId: string): Promise<Date | null> {
    const row = await this.prisma.withScope(scope, (tx) =>
      tx.zohoConnection.findUnique({
        where: { brandId },
        select: { lastPulledAt: true },
      }),
    );
    return row?.lastPulledAt ?? null;
  }

  /** Stamped with when the pull *started*, not the newest record seen —
   * see the migration comment on IntegrationConnection.lastPulledAt. */
  async recordPullRun(scope: Scope, brandId: string, pullStartedAt: Date): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.zohoConnection.updateMany({
        where: { brandId },
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
      tx.zohoConnection.findUnique({
        where: { brandId },
      }),
    );
    if (!row?.encryptedCredentials || row.status !== 'CONNECTED') return null;

    const credentials = JSON.parse(
      decryptCredential(row.encryptedCredentials, this.env.CREDENTIAL_ENCRYPTION_KEY),
    ) as ZohoCredentials;
    const config = row.config as unknown as ZohoConnectionConfig;

    const connection = (token: CachedAccessToken): AccountingConnection => ({
      brandId,
      organisationId: config.organizationId,
      accessToken: token.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: new Date(token.expiresAt),
    });

    const cached = await this.cachedAccessToken(brandId);
    if (cached) return connection(cached);

    // One refresh per brand at a time: jobs that start together (a backfill,
    // a pull and its cascades) wait for the first one's token rather than
    // each asking Zoho's OAuth server for their own.
    const lockKey = `zoho:token-refresh:${brandId}`;
    const lockToken = await this.redis.acquireLock(lockKey, TOKEN_REFRESH_LOCK_SECONDS);
    if (!lockToken) {
      for (let waited = 0; waited < TOKEN_REFRESH_WAIT_MS; waited += TOKEN_REFRESH_POLL_MS) {
        await new Promise((resolve) => setTimeout(resolve, TOKEN_REFRESH_POLL_MS));
        const fresh = await this.cachedAccessToken(brandId);
        if (fresh) return connection(fresh);
      }
      // The holder is taking too long or died: refresh independently.
    }
    try {
      const again = lockToken ? await this.cachedAccessToken(brandId) : null;
      if (again) return connection(again);
      const { accessToken, expiresAt } = await this.zoho.refreshAccessToken(
        credentials.refreshToken,
      );
      await this.cacheAccessToken(brandId, accessToken, expiresAt);
      return connection({ accessToken, expiresAt: expiresAt.toISOString() });
    } finally {
      if (lockToken) await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  /** Keeps an access token for the brand's jobs until shortly before it
   * expires. Also called by the connect callback with the token its code
   * exchange returned, so the first jobs after connecting need no refresh. */
  async cacheAccessToken(brandId: string, accessToken: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(
      60,
      Math.round((expiresAt.getTime() - TOKEN_CACHE_SAFETY_BUFFER_MS - Date.now()) / 1000),
    );
    await this.redis.setJson(
      this.tokenCacheKey(brandId),
      { accessToken, expiresAt: expiresAt.toISOString() } satisfies CachedAccessToken,
      ttlSeconds,
    );
  }

  private async cachedAccessToken(brandId: string): Promise<CachedAccessToken | null> {
    const cached = await this.redis.getJson<CachedAccessToken>(this.tokenCacheKey(brandId));
    return cached && new Date(cached.expiresAt).getTime() > Date.now() ? cached : null;
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
        client.zohoConnection.findMany({
          where: {
            status: 'CONNECTED',
            encryptedCredentials: { not: null },
            // Real-time (0) brands are never pulled on a timer.
            pullFrequencyMinutes: { gt: 0 },
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
      tx.zohoConnection
        .updateMany({
          where: { brandId },
          // Zoho's own message can be long; the column is display-oriented.
          data: { health: reason.slice(0, 500) },
        })
        // A brand that was never connected has no row to mark — nothing to do.
        .catch(() => undefined),
    );
  }

  /**
   * Records that Zoho itself rejected the refresh token (invalid_grant) —
   * unlike markUnhealthy's transient blip, there is no "heals itself on the
   * next successful call" path from here: the credential is actually dead,
   * and reconnecting via OAuth (which resets status back to CONNECTED in
   * saveZohoConnection) is the only way forward regardless of what this
   * reads in the meantime. Setting status (not just health) is intentional
   * here for exactly the reason markUnhealthy's own comment says not to for
   * a transient failure: buildAccountingConnection returning null for a
   * REVOKED brand is correct, not a regression, once the token is actually gone.
   */
  async markRevoked(scope: Scope, brandId: string, reason: string): Promise<void> {
    await this.prisma.withScope(scope, (tx) =>
      tx.zohoConnection
        .updateMany({
          where: { brandId },
          data: { status: 'REVOKED', health: reason.slice(0, 500) },
        })
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
      tx.zohoConnection.updateMany({
        where: { brandId },
        data: { lastSyncAt: new Date(), health: 'Healthy' },
      }),
    );
  }
  /**
   * Whether Zoho is connected in scope —
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
      tx.zohoConnection.findMany({
        where: { status: 'CONNECTED', ...(brandId ? { brandId } : {}) },
        // A connection that has not synced yet must not shadow one that has:
        // plain `desc` puts Postgres's default NULLS FIRST.
        orderBy: { lastSyncAt: { sort: 'desc', nulls: 'last' } },
        select: { lastSyncAt: true },
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
        client.zohoConnection.findMany({
          where: { status: 'CONNECTED' },
          select: { brandId: true, config: true, brand: { select: { merchantId: true } } },
        }),
    );
    return rows
      .filter(
        (row) => (row.config as ZohoConnectionConfig | null)?.organizationId === organizationId,
      )
      .map((row) => ({ brandId: row.brandId, merchantId: row.brand.merchantId }));
  }

  /**
   * Persists the last accepted webhook delivery for every brand connected to
   * this organization (ZohoWebhookService.process) — same organization
   * lookup as findBrandsForZohoOrganization, since a webhook carries no
   * brandId of its own. Durable counterpart to what used to live only in
   * Redis with a 30-day TTL: the "is Zoho actually calling us?" panel must
   * not go permanently blank on a cache flush or a month of Zoho silence.
   * Non-fatal by design, same as markUnhealthy/markRevoked — a webhook
   * having been received and processed is the fact that matters; failing to
   * record it for display must not turn into an error response back to Zoho.
   */
  async recordWebhookDelivery(organizationId: string, entry: ZohoWebhookDelivery): Promise<void> {
    const brandIds = (await this.findBrandsForZohoOrganization(organizationId)).map(
      (b) => b.brandId,
    );
    if (brandIds.length === 0) return;
    await this.prisma
      .withoutScope(
        `zoho webhook: recording last delivery for organization ${organizationId}`,
        (client) =>
          client.zohoConnection.updateMany({
            where: { brandId: { in: brandIds } },
            data: { lastWebhookDelivery: entry as unknown as Prisma.InputJsonValue },
          }),
      )
      .catch(() => undefined);
  }

  /** Multiple brands sharing one Zoho organization each get the delivery
   * recorded (recordWebhookDelivery updates all of them), so any one row is
   * representative — this just reads the first. */
  async getLastWebhookDelivery(organizationId: string): Promise<ZohoWebhookDelivery | null> {
    const brandIds = (await this.findBrandsForZohoOrganization(organizationId)).map(
      (b) => b.brandId,
    );
    if (brandIds.length === 0) return null;
    const row = await this.prisma.withoutScope(
      `zoho webhook: reading last delivery for organization ${organizationId}`,
      (client) =>
        client.zohoConnection.findFirst({
          where: { brandId: { in: brandIds } },
          select: { lastWebhookDelivery: true },
        }),
    );
    return (row?.lastWebhookDelivery as unknown as ZohoWebhookDelivery | null) ?? null;
  }
}
