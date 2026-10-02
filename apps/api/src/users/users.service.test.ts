/**
 * UsersService against a real database (TDD-001 §12.1), same reasoning as
 * BrandSettingsService's own suite: RLS, the transaction boundary and the
 * rank/brand-scoping rules this service owns are database and business-rule
 * behaviour a mocked Prisma can't demonstrate. Needs a migrated, seeded
 * database:
 *   pnpm setup:local && pnpm --filter @sugrpay/api test
 *
 * Runs against a throwaway merchant/brands/users created in beforeAll, never
 * against the seeded fixtures in prisma/seed.ts — the last-owner and
 * self-protection rules mutate account status/role, and a shared fixture
 * would make one test's assertions depend on another's having run first.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestScope } from '@sugrpay/shared';
import { createFakeMailPort } from '../adapters/mail/fake-mail.port.js';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { AuthMailService } from '../auth/auth-mail.service.js';
import { UsersService } from './users.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('UsersService', () => {
  const prisma = new PrismaService(env!);
  const mail = createFakeMailPort();
  const users = new UsersService(
    prisma,
    new PasswordResetService(prisma),
    new AuthMailService(mail, env!),
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let merchantId = '';
  let brandAId = '';
  let brandBId = '';
  let ownerAId = '';
  let ownerBId = '';
  let brandAdminId = '';
  let salesUserId = '';
  let multiBrandUserId = '';

  let ownerAScope: RequestScope;
  let adminScope: RequestScope;
  let brandAdminScope: RequestScope;

  beforeAll(async () => {
    const merchant = await owner.merchant.create({
      data: {
        name: `Users Fixture ${randomUUID().slice(0, 8)}`,
        contactEmail: 'ops@users-fixture.test',
      },
    });
    merchantId = merchant.id;

    const [brandA, brandB] = await Promise.all([
      owner.brand.create({
        data: { merchantId, legalName: 'Fixture Brand A', displayName: 'Fixture Brand A' },
      }),
      owner.brand.create({
        data: { merchantId, legalName: 'Fixture Brand B', displayName: 'Fixture Brand B' },
      }),
    ]);
    brandAId = brandA.id;
    brandBId = brandB.id;

    const [ownerA, ownerB, admin, brandAdmin, salesUser, multiBrandUser] = await Promise.all([
      owner.user.create({
        data: {
          merchantId,
          email: 'owner-a@users-fixture.test',
          name: 'Fixture Owner A',
          passwordHash: 'unused',
          role: 'MERCHANT_OWNER',
          status: 'ACTIVE',
        },
      }),
      owner.user.create({
        data: {
          merchantId,
          email: 'owner-b@users-fixture.test',
          name: 'Fixture Owner B',
          passwordHash: 'unused',
          role: 'MERCHANT_OWNER',
          status: 'ACTIVE',
        },
      }),
      owner.user.create({
        data: {
          merchantId,
          email: 'admin@users-fixture.test',
          name: 'Fixture Admin',
          passwordHash: 'unused',
          role: 'MERCHANT_ADMIN',
          status: 'ACTIVE',
        },
      }),
      owner.user.create({
        data: {
          merchantId,
          email: 'brand-admin@users-fixture.test',
          name: 'Fixture Brand Admin',
          passwordHash: 'unused',
          role: 'BRAND_ADMIN',
          status: 'ACTIVE',
          assignments: { create: [{ brandId: brandAId }] },
        },
      }),
      owner.user.create({
        data: {
          merchantId,
          email: 'sales@users-fixture.test',
          name: 'Fixture Sales',
          passwordHash: 'unused',
          role: 'SALES_USER',
          status: 'ACTIVE',
          assignments: { create: [{ brandId: brandBId }] },
        },
      }),
      // On both brands, so the Brand Admin (scoped to brandA only) can see
      // and manage this user while brandB stays a brand they cannot see —
      // this is what proves updateBrands never removes an assignment outside
      // the actor's own administered set.
      owner.user.create({
        data: {
          merchantId,
          email: 'multi-brand@users-fixture.test',
          name: 'Fixture Multi Brand',
          passwordHash: 'unused',
          role: 'SALES_USER',
          status: 'ACTIVE',
          assignments: { create: [{ brandId: brandAId }, { brandId: brandBId }] },
        },
      }),
    ]);
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;
    brandAdminId = brandAdmin.id;
    salesUserId = salesUser.id;
    multiBrandUserId = multiBrandUser.id;

    ownerAScope = {
      merchantId,
      userId: ownerAId,
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-owner-a',
      sourceIp: '203.0.113.7',
    };
    adminScope = {
      merchantId,
      userId: admin.id,
      role: 'MERCHANT_ADMIN',
      assignedBrandIds: [],
      sessionId: 'test-admin',
      sourceIp: '203.0.113.7',
    };
    brandAdminScope = {
      merchantId,
      userId: brandAdminId,
      role: 'BRAND_ADMIN',
      assignedBrandIds: [brandAId],
      sessionId: 'test-brand-admin',
      sourceIp: '203.0.113.7',
    };
  });

  afterAll(async () => {
    if (merchantId) await owner.merchant.delete({ where: { id: merchantId } });
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  it('refuses a Brand Admin inviting a role above their own rank', async () => {
    await expect(
      users.invite(brandAdminScope, {
        name: 'Too Senior',
        email: `too-senior-${randomUUID()}@users-fixture.test`,
        role: 'MERCHANT_ADMIN',
        brandIds: [],
      }),
    ).rejects.toThrow(/may not assign a role above your own/);
  });

  it('refuses a Brand Admin assigning a brand they do not administer', async () => {
    await expect(
      users.invite(brandAdminScope, {
        name: 'Wrong Brand',
        email: `wrong-brand-${randomUUID()}@users-fixture.test`,
        role: 'SALES_USER',
        brandIds: [brandBId],
      }),
    ).rejects.toThrow(/only assign brands you administer/);
  });

  it('refuses a brand-scoped role invite with no brand at all', async () => {
    await expect(
      users.invite(ownerAScope, {
        name: 'No Brand',
        email: `no-brand-${randomUUID()}@users-fixture.test`,
        role: 'SALES_USER',
        brandIds: [],
      }),
    ).rejects.toThrow(/needs at least one assigned brand/);
  });

  it('invites a user: creates an INVITED row, assigns brands, and issues a set-password link', async () => {
    const email = `new-hire-${randomUUID()}@users-fixture.test`;
    const created = await users.invite(ownerAScope, {
      name: 'New Hire',
      email,
      role: 'SALES_USER',
      brandIds: [brandAId],
    });

    expect(created.status).toBe('INVITED');
    expect(created.assignedBrandIds).toEqual([brandAId]);

    const tokenCount = await owner.passwordResetToken.count({ where: { userId: created.id } });
    expect(tokenCount).toBe(1);
    expect(mail.outbox.some((m) => m.to.includes(email))).toBe(true);
  });

  it("scopes a Brand Admin's list to users sharing one of their brands, plus themself", async () => {
    const result = await users.list(brandAdminScope, { page: 1, pageSize: 100 });
    const ids = result.data.map((u) => u.id);
    expect(ids).toContain(brandAdminId);
    expect(ids).not.toContain(salesUserId); // salesUser is on brandB only
  });

  it('refuses to change your own role', async () => {
    await expect(users.updateRole(ownerAScope, ownerAId, 'MERCHANT_ADMIN')).rejects.toThrow(
      /cannot change your own role/,
    );
  });

  it('refuses to change your own account status', async () => {
    await expect(users.updateStatus(ownerAScope, ownerAId, 'SUSPENDED')).rejects.toThrow(
      /cannot change your own account status/,
    );
  });

  it('refuses an Admin suspending an Owner — a rank violation, not just a role change', async () => {
    await expect(users.updateStatus(adminScope, ownerBId, 'SUSPENDED')).rejects.toThrow(
      /insufficient permissions for this user/,
    );
  });

  it('lets one Owner suspend another when an active Owner remains', async () => {
    const updated = await users.updateStatus(ownerAScope, ownerBId, 'SUSPENDED');
    expect(updated.status).toBe('SUSPENDED');

    // Restore for isolation from any test order change.
    await users.updateStatus(ownerAScope, ownerBId, 'ACTIVE');
  });

  it('a Brand Admin only ever touches brand assignments within their own administered brands', async () => {
    // multiBrandUser holds both brandA and brandB. brandAdminScope
    // administers brandA only and submits an empty list (revoking brandA) —
    // brandB must survive untouched, since a full delete-and-recreate would
    // wipe an assignment this actor cannot even see.
    //
    // Asserted via the unscoped `owner` client rather than the returned
    // ManagedUser: the `user_brand_assignment` RLS policy scopes every read
    // inside a Brand-Admin transaction to app_brand_visible() too, so the
    // service's own post-write read of `assignments` can only ever show
    // brandA-related rows back to this actor — never brandB's — regardless
    // of whether brandB's row actually survived in the database.
    await users.updateBrands(brandAdminScope, multiBrandUserId, []);

    const rows = await owner.userBrandAssignment.findMany({
      where: { userId: multiBrandUserId },
      select: { brandId: true },
    });
    expect(rows.map((r) => r.brandId)).toEqual([brandBId]);
  });

  describe('moving between all-brand and brand-scoped roles', () => {
    async function createAdmin(): Promise<string> {
      const row = await owner.user.create({
        data: {
          merchantId,
          email: `demote-${randomUUID()}@users-fixture.test`,
          name: 'Fixture Demotee',
          passwordHash: 'unused',
          role: 'MERCHANT_ADMIN',
          status: 'ACTIVE',
        },
      });
      return row.id;
    }

    it('refuses a demotion to a brand-scoped role without brands', async () => {
      const id = await createAdmin();
      await expect(users.updateRole(ownerAScope, id, 'SALES_USER')).rejects.toThrow(
        /needs at least one assigned brand/,
      );
      // Rolled back: still an Admin, not a brand-less Sales user.
      const row = await owner.user.findUniqueOrThrow({ where: { id } });
      expect(row.role).toBe('MERCHANT_ADMIN');
    });

    it('demotes and assigns brands in one step', async () => {
      const id = await createAdmin();
      const updated = await users.updateRole(ownerAScope, id, 'FINANCE_USER', [brandBId]);
      expect(updated.role).toBe('FINANCE_USER');
      expect(updated.assignedBrandIds).toEqual([brandBId]);
    });

    it('clears assignments on promotion to an all-brand role', async () => {
      const id = await createAdmin();
      await users.updateRole(ownerAScope, id, 'SALES_USER', [brandAId]);
      const promoted = await users.updateRole(ownerAScope, id, 'MERCHANT_ADMIN');
      expect(promoted.assignedBrandIds).toEqual([]);
    });

    it('refuses an all-brand actor emptying a brand-scoped user’s brands', async () => {
      await expect(users.updateBrands(ownerAScope, salesUserId, [])).rejects.toThrow(
        /needs at least one assigned brand/,
      );
    });
  });
});
