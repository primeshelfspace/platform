/**
 * Phase 2 against a real database: subscriptions switch products on and off
 * for the very next request, product roles are granted under the seniority
 * rules, and locations are visible through row-level security exactly as the
 * architecture plan describes (all-brand roles see all; others see their
 * brands' locations plus the ones assigned to them).
 *
 * Runs against a throwaway company created in beforeAll. Needs a migrated
 * database: pnpm setup:local && pnpm --filter @platform/api test
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeMailPort } from '@platform/server';
import { loadEnv } from '@platform/server';
import { getEnv } from '@platform/server';
import { EventBus } from '@platform/server';
import { OutboxDispatcher } from '@platform/server';
import { AuthMailService } from '../../auth/application/auth-mail.service.js';
import { PasswordResetService } from '../../auth/application/password-reset.service.js';
import { SessionService } from '../../auth/application/session.service.js';
import { PrismaClient } from '../../database/client.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import { LocationsService } from '../../locations/application/locations.service.js';
import { productScope } from '@platform/server';
import { UsersService } from '../../users/application/users.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('subscriptions, product roles and locations', () => {
  const prisma = new PlatformPrismaService(env!);
  const outbox = new PlatformOutbox(prisma, new OutboxDispatcher(new EventBus(), env!));
  const sessions = new SessionService(prisma);
  const subscriptions = new SubscriptionsService(prisma, outbox);
  const locations = new LocationsService(prisma, outbox);
  const users = new UsersService(
    prisma,
    new PasswordResetService(prisma),
    new AuthMailService(createFakeMailPort(), env!),
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.PLATFORM_DIRECT_DATABASE_URL ?? env!.PLATFORM_DATABASE_URL } },
  });

  let merchantId = '';
  let ownerUserId = '';
  let brandAdminId = '';
  let salesUserId = '';
  let ownerToken = '';
  let brandAdminToken = '';
  let storeAId = '';
  let storeBId = '';
  let warehouseId = '';

  const scopeOf = async (token: string): Promise<RequestScope> => {
    const scope = await sessions.resolve(token, null);
    if (!scope) throw new Error('session did not resolve');
    return scope;
  };

  const createUser = (role: 'MERCHANT_OWNER' | 'BRAND_ADMIN' | 'SALES_USER', brandIds: string[]) =>
    owner.user.create({
      data: {
        merchantId,
        email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@phase2.test`,
        name: role,
        passwordHash: 'x',
        role,
        status: 'ACTIVE',
        assignments: { create: brandIds.map((brandId) => ({ brandId })) },
        productRoles: { create: { product: 'INVOICING', role } },
      },
    });

  const sessionFor = async (userId: string): Promise<string> => {
    const token = randomBytes(32).toString('hex');
    await owner.session.create({
      data: {
        userId,
        tokenHash: SessionService.hash(token),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return token;
  };

  beforeAll(async () => {
    const merchant = await owner.merchant.create({
      data: {
        name: `Phase 2 Fixture ${randomUUID().slice(0, 8)}`,
        contactEmail: 'ops@phase2.test',
        subscriptions: { create: { product: 'INVOICING' } },
      },
    });
    merchantId = merchant.id;

    const [brandA, brandB] = await Promise.all([
      owner.brand.create({ data: { merchantId, legalName: 'Brand A', displayName: 'Brand A' } }),
      owner.brand.create({ data: { merchantId, legalName: 'Brand B', displayName: 'Brand B' } }),
    ]);

    ownerUserId = (await createUser('MERCHANT_OWNER', [])).id;
    brandAdminId = (await createUser('BRAND_ADMIN', [brandA.id])).id;
    salesUserId = (await createUser('SALES_USER', [brandA.id])).id;
    ownerToken = await sessionFor(ownerUserId);
    brandAdminToken = await sessionFor(brandAdminId);

    const ownerScope = await scopeOf(ownerToken);
    storeAId = (
      await locations.create(ownerScope, {
        name: 'Store A',
        kind: 'STORE',
        brandId: brandA.id,
        address: null,
      })
    ).id;
    storeBId = (
      await locations.create(ownerScope, {
        name: 'Store B',
        kind: 'STORE',
        brandId: brandB.id,
        address: null,
      })
    ).id;
    warehouseId = (
      await locations.create(ownerScope, {
        name: 'Warehouse',
        kind: 'WAREHOUSE',
        brandId: null,
        address: null,
      })
    ).id;
  });

  afterAll(async () => {
    if (merchantId) await owner.merchant.delete({ where: { id: merchantId } });
    await Promise.all([owner.$disconnect(), prisma.$disconnect()]);
  });

  it('resolves the company’s products and the user’s product roles into the session', async () => {
    const scope = await scopeOf(ownerToken);
    expect(scope.products).toEqual(['INVOICING']);
    expect(scope.productRoles).toEqual({ INVOICING: 'MERCHANT_OWNER' });
  });

  it('switches a product off and on for the very next request', async () => {
    await subscriptions.update(await scopeOf(ownerToken), 'INVOICING', { status: 'CANCELLED' });
    const cancelled = await scopeOf(ownerToken);
    expect(cancelled.products).toEqual([]);
    expect(() => productScope(cancelled, 'INVOICING')).toThrow(ForbiddenException);

    await subscriptions.update(await scopeOf(ownerToken), 'INVOICING', { status: 'ACTIVE' });
    expect(productScope(await scopeOf(ownerToken), 'INVOICING').role).toBe('MERCHANT_OWNER');
  });

  it('lists every product, including ones never subscribed to', async () => {
    const list = await subscriptions.list(await scopeOf(ownerToken));
    expect(list.map((s) => [s.product, s.status])).toEqual([
      ['INVOICING', 'ACTIVE'],
      ['HQ', 'NONE'],
    ]);
  });

  it('records an event with every subscription change', async () => {
    const events = await owner.outboxEvent.count({
      where: {
        topic: 'platform.subscription.changed',
        payload: { path: ['subscription', 'merchantId'], equals: merchantId },
      },
    });
    expect(events).toBeGreaterThanOrEqual(2);
  });

  it('lets an owner grant an HQ role, and the session picks it up', async () => {
    await subscriptions.update(await scopeOf(ownerToken), 'HQ', { status: 'ACTIVE' });
    const updated = await users.updateProductRole(
      await scopeOf(ownerToken),
      brandAdminId,
      'HQ',
      'MANAGER',
    );
    expect(updated.productRoles).toEqual({ INVOICING: 'BRAND_ADMIN', HQ: 'MANAGER' });

    const scope = await scopeOf(brandAdminToken);
    expect(scope.products).toEqual(expect.arrayContaining(['INVOICING', 'HQ']));
    expect(productScope(scope, 'HQ').productRoles?.HQ).toBe('MANAGER');
  });

  it('rejects a role that does not belong to the product', async () => {
    await expect(
      users.updateProductRole(await scopeOf(ownerToken), salesUserId, 'HQ', 'FINANCE_USER'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let a brand admin grant another product', async () => {
    await expect(
      users.updateProductRole(await scopeOf(brandAdminToken), salesUserId, 'HQ', 'ASSOCIATE'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the invoicing role and the platform role in step', async () => {
    const updated = await users.updateProductRole(
      await scopeOf(ownerToken),
      salesUserId,
      'INVOICING',
      'FINANCE_USER',
    );
    expect(updated.role).toBe('FINANCE_USER');
    expect(updated.productRoles.INVOICING).toBe('FINANCE_USER');
  });

  it('shows an owner every location', async () => {
    const all = await locations.list(await scopeOf(ownerToken));
    expect(all.map((l) => l.id).sort()).toEqual([storeAId, storeBId, warehouseId].sort());
  });

  it('shows a brand admin only their brand’s locations, plus assigned ones', async () => {
    const before = await locations.list(await scopeOf(brandAdminToken));
    expect(before.map((l) => l.id)).toEqual([storeAId]);

    await users.updateLocations(await scopeOf(ownerToken), brandAdminId, [warehouseId]);
    const after = await locations.list(await scopeOf(brandAdminToken));
    expect(after.map((l) => l.id).sort()).toEqual([storeAId, warehouseId].sort());
  });

  it('does not let a brand admin assign a location they cannot see', async () => {
    await expect(
      users.updateLocations(await scopeOf(brandAdminToken), salesUserId, [storeBId]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('archives instead of deleting, and refuses an unknown brand', async () => {
    const archived = await locations.update(await scopeOf(ownerToken), storeAId, {
      status: 'ARCHIVED',
    });
    expect(archived.status).toBe('ARCHIVED');
    await expect(
      locations.update(await scopeOf(ownerToken), storeAId, { brandId: randomUUID() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
