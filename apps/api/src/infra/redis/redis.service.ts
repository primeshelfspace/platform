import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';

/**
 * Redis serves two roles: cache, and BullMQ's broker.
 *
 * They get separate connections deliberately. BullMQ holds blocking commands
 * open, and a blocked connection cannot also serve a cache read.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly connections: Redis[] = [];

  readonly cache: Redis;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.cache = this.createConnection('cache');
  }

  /**
   * BullMQ requires maxRetriesPerRequest: null on its connections — with a
   * finite value it treats a reconnect as a fatal error and stalls the queue.
   */
  createQueueConnection(name: string): Redis {
    return this.createConnection(name, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }

  private createConnection(name: string, options: Record<string, unknown> = {}): Redis {
    const connection = new IORedis(this.env.REDIS_URL, {
      lazyConnect: false,
      connectionName: `fenwick-${name}`,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
      ...options,
    });

    connection.on('error', (error: Error) => {
      this.logger.error(`redis[${name}] ${error.message}`);
    });

    this.connections.push(connection);
    return connection;
  }

  async onModuleInit(): Promise<void> {
    await this.cache.ping();
    this.logger.log('redis connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.connections.map((c) => c.quit()));
  }

  async ping(): Promise<boolean> {
    return (await this.cache.ping()) === 'PONG';
  }

  // --- Cache helpers -------------------------------------------------------

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.cache.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds) await this.cache.set(key, raw, 'EX', ttlSeconds);
    else await this.cache.set(key, raw);
  }

  async invalidate(pattern: string): Promise<number> {
    // SCAN rather than KEYS: KEYS blocks the server for the length of the scan.
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.cache.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) removed += await this.cache.del(...keys);
    } while (cursor !== '0');
    return removed;
  }

  /**
   * Per-brand token bucket for the sync workers (TDD-001 §11.1): a brand that
   * has exhausted its provider rate limit defers, without blocking any other
   * brand's stream.
   */
  async acquireRateToken(brandId: string, limit: number, windowSeconds: number): Promise<boolean> {
    return this.acquireGenericRateToken(`ratelimit:brand:${brandId}`, limit, windowSeconds);
  }

  /**
   * Fixed-window token bucket keyed by whatever the caller supplies — the same
   * mechanism as acquireRateToken, generalized for callers that are not keyed
   * by brand (e.g. forgot-password, keyed by email address).
   */
  async acquireGenericRateToken(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const count = await this.cache.incr(key);
    if (count === 1) await this.cache.expire(key, windowSeconds);
    return count <= limit;
  }

  /**
   * FR-ZHO-webhook loop prevention and duplicate-delivery protection.
   *
   * Written before every outbound Zoho push (ZohoSyncService) so the webhook
   * this platform's own write causes Zoho to fire right back — the "echo" —
   * is recognised inside this key's 30s TTL and dropped instead of being
   * re-applied as though it were an independent edit made in Zoho. The same
   * key is written again once an inbound webhook is actually applied, so a
   * plain redelivery of that same webhook within the window is dropped too.
   *
   * Keyed by the platform's own record id, not Zoho's — the id both
   * directions agree on before any push completes (a push always targets an
   * already-existing local row; see ZohoWebhookService's own comment on why
   * the "new record" ambiguity can never apply to a platform-originated
   * write).
   */
  async markSyncAction(
    brandId: string,
    recordId: string,
    action: string,
    ttlSeconds = 30,
  ): Promise<void> {
    await this.cache.set(this.syncGuardKey(brandId, recordId, action), '1', 'EX', ttlSeconds);
  }

  async hasSyncAction(brandId: string, recordId: string, action: string): Promise<boolean> {
    return (await this.cache.exists(this.syncGuardKey(brandId, recordId, action))) === 1;
  }

  /** `{brand_id}:{record_id}:{action}`, namespaced against this cache's other
   * keys (zoho:access-token:…, ratelimit:brand:…) the same way those already are. */
  private syncGuardKey(brandId: string, recordId: string, action: string): string {
    return `zoho:sync-guard:${brandId}:${recordId}:${action}`;
  }
}
