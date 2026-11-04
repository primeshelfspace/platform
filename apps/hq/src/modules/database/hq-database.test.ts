/**
 * HQ's own database (TDD-001 §6.1), against the real policies, as the real
 * non-owner application role (hq_app): row-level security on the brand copy,
 * the copy being read-only to the application, and the platform events that
 * keep it current (BrandReplicaProjector). Also the request guard's brand
 * check, which reads the copy.
 *
 * Needs the HQ database bootstrapped and migrated:
 *   pnpm db:bootstrap && pnpm --filter @platform/hq-api db:migrate
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { RequestScope } from '@platform/kernel';
import {
  DEFAULT_BRAND_THEME_COLOR,
  PLATFORM_EVENTS,
  type BrandSnapshot,
} from '@platform/platform-contracts';
import { EventBus, getEnv, loadEnv, type DeliveredEvent, type Env } from '@platform/server';
import { HqScopeResolver } from '../../platform-access/platform-access.module.js';
import { BrandReplicaProjector } from '../platform-sync/application/brand-replica.projector.js';
import { HqPrismaService } from './hq-prisma.service.js';

loadEnv();
const hasDb = Boolean(process.env['HQ_DATABASE_URL']);
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('HQ database', () => {
  const env = getEnv() as Env;
  const prisma = new HqPrismaService(env);
  const projector = new BrandReplicaProjector(new EventBus(), prisma);
  const resolver = new HqScopeResolver(env, prisma);
  const brandIds: string[] = [];

  const snapshot = (overrides: Partial<BrandSnapshot> = {}): BrandSnapshot => {
    const id = overrides.id ?? randomUUID();
    if (!brandIds.includes(id)) brandIds.push(id);
    return {
      id,
      merchantId: randomUUID(),
      legalName: 'Acme Coffee LLC',
      displayName: 'Acme Coffee',
      salesPerson: null,
      businessType: null,
      phone: null,
      email: null,
      mailingAddress: null,
      billingAddress: null,
      taxId: null,
      currency: 'USD',
      timezone: 'America/New_York',
      themeColor: '#AA3366',
      logoKey: null,
      status: 'ACTIVE',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      ...overrides,
    };
  };
  const deliver = (brand: BrandSnapshot, id = randomUUID()) =>
    projector.handle({
      id,
      topic: PLATFORM_EVENTS.brandUpdated,
      aggregateId: brand.id,
      occurredAt: new Date(),
      payload: { brand },
    } as DeliveredEvent<{ brand: BrandSnapshot }>);
  const scopeOf = (merchantId: string, brands: string[] | 'all'): RequestScope => ({
    merchantId,
    userId: randomUUID(),
    role: brands === 'all' ? 'MERCHANT_OWNER' : 'READ_ONLY',
    assignedBrandIds: brands === 'all' ? [] : brands,
    sessionId: randomUUID(),
    sourceIp: null,
  });

  afterAll(async () => {
    await prisma.ownerClient.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
    await prisma.ownerClient.$disconnect();
  });

  describe('the brand copy, kept by platform events', () => {
    it('copies a brand from its platform event', async () => {
      const brand = snapshot();
      await deliver(brand);

      const copy = await prisma.ownerClient.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(copy).toMatchObject({
        merchantId: brand.merchantId,
        displayName: 'Acme Coffee',
        currency: 'USD',
        themeColor: '#AA3366',
        status: 'ACTIVE',
      });
    });

    it('applies each event once, and never an older snapshot over a newer one', async () => {
      const brand = snapshot({ updatedAt: '2026-11-02T00:00:00.000Z' });
      const eventId = randomUUID();
      await deliver(brand, eventId);
      await deliver({ ...brand, displayName: 'Replayed' }, eventId);
      await deliver({ ...brand, displayName: 'Stale', updatedAt: '2026-11-01T00:00:00.000Z' });

      const copy = await prisma.ownerClient.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(copy.displayName).toBe('Acme Coffee');

      await deliver({
        ...brand,
        displayName: 'Renamed',
        status: 'ARCHIVED',
        updatedAt: '2026-11-03T00:00:00.000Z',
      });
      const renamed = await prisma.ownerClient.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(renamed).toMatchObject({ displayName: 'Renamed', status: 'ARCHIVED' });
    });

    it('gives a brand with no colour the default one', async () => {
      const brand = snapshot({ themeColor: '' });
      await deliver(brand);
      const copy = await prisma.ownerClient.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(copy.themeColor).toBe(DEFAULT_BRAND_THEME_COLOR);
    });
  });

  describe('row-level security, as hq_app', () => {
    it('shows a company only its own brands, and a brand-scoped user only theirs', async () => {
      const merchantId = randomUUID();
      const mine = snapshot({ merchantId });
      const alsoMine = snapshot({ merchantId });
      const theirs = snapshot();
      for (const brand of [mine, alsoMine, theirs]) await deliver(brand);

      const asAdmin = await prisma.withScope(scopeOf(merchantId, 'all'), (tx) =>
        tx.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true } }),
      );
      expect(asAdmin.map((b) => b.id).sort()).toEqual([mine.id, alsoMine.id].sort());

      const asAssigned = await prisma.withScope(scopeOf(merchantId, [mine.id]), (tx) =>
        tx.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true } }),
      );
      expect(asAssigned.map((b) => b.id)).toEqual([mine.id]);
    });

    it('sees nothing with no scope', async () => {
      const brand = snapshot();
      await deliver(brand);
      expect(await prisma.brand.findMany({ where: { id: brand.id } })).toEqual([]);
    });

    it('may not write the brand copy or read the event bookkeeping', async () => {
      const brand = snapshot();
      await deliver(brand);
      const scope = scopeOf(brand.merchantId, 'all');

      await expect(
        prisma.withScope(scope, (tx) =>
          tx.brand.update({ where: { id: brand.id }, data: { displayName: 'Hijacked' } }),
        ),
      ).rejects.toThrow();
      await expect(prisma.withScope(scope, (tx) => tx.processedEvent.findMany())).rejects.toThrow();
      const copy = await prisma.ownerClient.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(copy.displayName).toBe('Acme Coffee');
    });
  });

  it("answers the request guard's brand check from the copy", async () => {
    const brand = snapshot();
    await deliver(brand);

    expect(await resolver.brandInCompany(scopeOf(brand.merchantId, 'all'), brand.id)).toBe(true);
    expect(await resolver.brandInCompany(scopeOf(randomUUID(), 'all'), brand.id)).toBe(false);
    expect(await resolver.brandInCompany(scopeOf(brand.merchantId, 'all'), 'not-a-uuid')).toBe(
      false,
    );
  });
});
