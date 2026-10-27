/**
 * The short lock ZohoSyncService uses to stop two jobs creating the same
 * record in Zoho twice. Needs a running Redis (REDIS_URL), like the other
 * Redis-backed tests.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { RedisService } from './redis.service.js';

loadEnv();
const describeWithRedis = process.env['REDIS_URL'] ? describe : describe.skip;

describeWithRedis('RedisService locks', () => {
  const redis = new RedisService(getEnv());

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  it('gives the lock to one caller at a time', async () => {
    const key = `test:${randomUUID()}`;
    const first = await redis.acquireLock(key, 10);
    expect(first).not.toBeNull();
    expect(await redis.acquireLock(key, 10)).toBeNull();

    await redis.releaseLock(key, first!);
    expect(await redis.acquireLock(key, 10)).not.toBeNull();
  });

  it('does not release a lock someone else now holds', async () => {
    const key = `test:${randomUUID()}`;
    // The first holder ran past its TTL, and a second caller took the lock.
    const stale = await redis.acquireLock(key, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const current = await redis.acquireLock(key, 10);
    expect(current).not.toBeNull();

    // The first holder finishing late must leave the second one's lock alone.
    await redis.releaseLock(key, stale!);
    expect(await redis.acquireLock(key, 10)).toBeNull();

    await redis.releaseLock(key, current!);
  });
});
