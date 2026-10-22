/**
 * RateLimitGuard with an in-memory counter in place of Redis: which buckets a
 * request counts against, that the limit answers 429, and that a Redis outage
 * lets requests through rather than taking sign-in down.
 */
import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { RedisService } from '../infra/redis/redis.service.js';
import { RateLimitGuard, type RateLimitRule } from './rate-limit.js';

function setup(rule: RateLimitRule | undefined, redisDown = false) {
  const counts = new Map<string, number>();
  const redis = {
    acquireGenericRateToken: async (key: string, limit: number) => {
      if (redisDown) throw new Error('ECONNREFUSED');
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= limit;
    },
  } as unknown as RedisService;
  const reflector = { get: () => rule } as unknown as Reflector;
  const guard = new RateLimitGuard(reflector, redis);
  const call = (request: Record<string, unknown>) =>
    guard.canActivate({
      getHandler: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '203.0.113.9', params: {}, body: {}, ...request }),
      }),
    } as unknown as ExecutionContext);
  return { call, counts };
}

const tooMany = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );

describe('RateLimitGuard', () => {
  it('lets every request through on a route without a rule', async () => {
    const { call } = setup(undefined);
    for (let i = 0; i < 50; i++) await expect(call({})).resolves.toBe(true);
  });

  it('answers 429 once one address passes the limit', async () => {
    const { call } = setup({ name: 'pdf', limit: 3, windowSeconds: 60 });
    for (let i = 0; i < 3; i++) await call({});
    await tooMany(call({}));
    // Another address still has its own budget.
    await expect(call({ ip: '198.51.100.1' })).resolves.toBe(true);
  });

  it('counts per email address on sign-in, whatever the address, case-insensitively', async () => {
    const { call } = setup({ name: 'login', limit: 1000, windowSeconds: 300, perEmailLimit: 2 });
    await call({ body: { email: 'dana@example.com' } });
    await call({ ip: '198.51.100.1', body: { email: 'DANA@example.com ' } });
    await tooMany(call({ ip: '198.51.100.2', body: { email: 'dana@example.com' } }));
    await expect(call({ body: { email: 'someone-else@example.com' } })).resolves.toBe(true);
  });

  it('counts per invoice link on public routes, across addresses', async () => {
    const { call } = setup({ name: 'intent', limit: 100, windowSeconds: 60, perTokenLimit: 2 });
    await call({ ip: '1.1.1.1', params: { token: 'abc' } });
    await call({ ip: '2.2.2.2', params: { token: 'abc' } });
    await tooMany(call({ ip: '3.3.3.3', params: { token: 'abc' } }));
  });

  it('applies a per-company quota to signed-in requests, with no per-address count', async () => {
    const { call, counts } = setup({ name: 'mail', windowSeconds: 86400, perCompanyLimit: 2 });
    const company = { scope: { merchantId: 'company-1' } };
    await call(company);
    await call(company);
    await tooMany(call(company));
    await expect(call({ scope: { merchantId: 'company-2' } })).resolves.toBe(true);
    expect([...counts.keys()].some((key) => key.includes(':ip:'))).toBe(false);
  });

  it('lets requests through when Redis is unavailable', async () => {
    const { call } = setup({ name: 'login', limit: 1, windowSeconds: 60 }, true);
    await expect(call({})).resolves.toBe(true);
    await expect(call({})).resolves.toBe(true);
  });
});
