/**
 * The product company APIs, end to end against the real platform database
 * (docs/product/stories/product-company-apis.md): Company Profile, Brand
 * Management, User Management, User List and Role List. Each call is made
 * with a scope resolved from a real product JWT, exactly as the request guard
 * resolves it. Request validation (missing fields, formats, password rules,
 * no Brands) is covered by the schema tests in packages/platform-contracts;
 * refusing an invalid or expired JWT, or a product no longer enabled, is
 * covered once for every endpoint by product-session.test.ts (the guard
 * refuses before any handler runs).
 */
import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import type { Product, RequestScope } from '@platform/kernel';
import {
  createFakeMailPort,
  EventBus,
  getEnv,
  loadEnv,
  OutboxDispatcher,
  type Env,
  type RedisService,
} from '@platform/server';
import { PrismaClient } from '../../database/client.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import { AuthMailService } from '../../auth/application/auth-mail.service.js';
import { AuthService } from '../../auth/application/auth.service.js';
import { PasswordResetService } from '../../auth/application/password-reset.service.js';
import { ProductSessionService } from '../../auth/application/product-session.service.js';
import { SessionService } from '../../auth/application/session.service.js';
import { MerchantService } from '../../companies/application/merchant.service.js';
import { ProductsService } from '../../subscriptions/application/products.service.js';
import { SubscriptionsService } from '../../subscriptions/application/subscriptions.service.js';
import { CompanyProfileService } from './company-profile.service.js';
import { ProductBrandsService } from './product-brands.service.js';
import { ProductRolesService } from './product-roles.service.js';
import { ProductUsersService } from './product-users.service.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL']);
const baseEnv = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const JWT_SECRET = 'test-product-jwt-secret-0123456789abcdef';
const US_PHONE = { country: 'US', number: '(202) 555-0143' };

describeWithDb('product company APIs', () => {
  const env = {
    ...baseEnv!,
    PRODUCT_JWT_SECRET: JWT_SECRET,
    HQ_PUBLIC_URL: 'https://hq.example.test',
  } as Env;
  const prisma = new PlatformPrismaService(env);
  const redis = { acquireGenericRateToken: async () => true } as unknown as RedisService;
  const sessions = new SessionService(prisma, env);
  const auth = new AuthService(
    prisma,
    sessions,
    new PasswordResetService(prisma),
    new AuthMailService(createFakeMailPort(), env),
    redis,
  );
  const outbox = new PlatformOutbox(prisma, new OutboxDispatcher(new EventBus(), env));
  const merchants = new MerchantService(prisma, outbox);
  const subscriptions = new SubscriptionsService(prisma, outbox);
  const products = new ProductsService(prisma, outbox, subscriptions, sessions, env);
  const productSessions = new ProductSessionService(prisma, sessions);
  const profiles = new CompanyProfileService(prisma);
  const brands = new ProductBrandsService(prisma, outbox);
  const users = new ProductUsersService(prisma, sessions);
  const roles = new ProductRolesService();
  const owner = new PrismaClient({
    datasources: { db: { url: env.PLATFORM_DIRECT_DATABASE_URL ?? env.PLATFORM_DATABASE_URL } },
  });
  const emails: string[] = [];

  const run = () => randomUUID().slice(0, 8);
  const newEmail = () => {
    const email = `team-${run()}@product-company-test.test`;
    emails.push(email);
    return email;
  };
  const resolve = async (token: string): Promise<RequestScope> => {
    const scope = await sessions.resolve(token, null);
    if (!scope) throw new Error('token did not resolve');
    return scope;
  };
  /** A product scope (from a real product JWT) for a platform scope. */
  const inProduct = async (scope: RequestScope, product: Product = 'HQ') =>
    resolve((await products.continueInto(scope, product)).token);
  const brandInput = (displayName = `Brand ${run()}`) => ({
    legalName: `${displayName} LLC`,
    displayName,
    currency: 'USD' as const,
    timezone: 'America/Chicago',
  });

  /** A Company with both products, its Company Admin, and the admin's HQ scope. */
  const company = async () => {
    const email = newEmail();
    const signedUp = await auth.register(
      { email, password: PASSWORD },
      { sourceIp: null, userAgent: null },
    );
    const platform = await resolve(signedUp.token);
    const companyName = `Team Co ${run()}`;
    await merchants.registerCompany(platform, {
      companyName,
      legalName: `${companyName} LLC`,
      taxId: '98-7654321',
      brandStructure: 'SINGLE',
    });
    const first = await merchants.addFirstBrand(platform, {
      ...brandInput('Flagship'),
      themeColor: '#AA3366',
    });
    await products.enable(platform, ['INVOICING', 'HQ']);
    const admin = await resolve(signedUp.token);
    return {
      email,
      companyName,
      admin,
      hq: await inProduct(admin, 'HQ'),
      sugrpay: await inProduct(admin, 'INVOICING'),
      firstBrandId: first.brand.id,
    };
  };
  /** Adds a user through User Management and returns them and their HQ scope. */
  const member = async (
    adminHq: RequestScope,
    brandIds: string[],
    role = 'MANAGER',
  ): Promise<{ id: string; email: string; hq: RequestScope; token: string }> => {
    const email = newEmail();
    const added = await users.add(adminHq, {
      name: 'Team Member',
      email,
      phone: US_PHONE,
      password: PASSWORD,
      role,
      brandIds,
    });
    const { token } = await auth.login({
      email,
      password: PASSWORD,
      sourceIp: null,
      userAgent: null,
    });
    const launch = await products.continueInto(await resolve(token), 'HQ');
    // `token` is the product JWT: resolve it again to see changes, as the
    // guard does on every call.
    return { id: added.id, email, hq: await resolve(launch.token), token: launch.token };
  };
  const failureOf = async (work: Promise<unknown> | (() => unknown)) => {
    const error = await Promise.resolve()
      .then(typeof work === 'function' ? work : () => work)
      .then(
        () => null,
        (e: unknown) => e,
      );
    if (!error) throw new Error('expected the call to fail');
    const body = (error as { getResponse?: () => unknown }).getResponse?.() as
      { code?: string; issues?: { path: string }[] } | undefined;
    return { error, code: body?.code, field: body?.issues?.[0]?.path };
  };
  const signIn = (email: string) =>
    auth.login({ email, password: PASSWORD, sourceIp: null, userAgent: null });

  afterAll(async () => {
    const rows = await owner.user.findMany({ where: { email: { in: emails } } });
    await owner.merchant.deleteMany({ where: { id: { in: rows.map((u) => u.merchantId) } } });
    await owner.$disconnect();
    await prisma.$disconnect();
  });

  // --- Company Profile ---------------------------------------------------

  describe('Company Profile — Company Details & Brands', () => {
    it("returns the Company's details and the Brands the Company Admin can access", async () => {
      const c = await company();

      const profile = await profiles.get(c.hq, c.hq.merchantId);

      expect(profile.company).toEqual({
        id: c.hq.merchantId,
        companyName: c.companyName,
        legalName: `${c.companyName} LLC`,
        taxId: '98-7654321',
        brandStructure: 'SINGLE',
        status: 'ACTIVE',
        contactEmail: c.email,
      });
      expect(profile.brands).toEqual([
        {
          id: c.firstBrandId,
          legalName: 'Flagship LLC',
          displayName: 'Flagship',
          currency: 'USD',
          timezone: 'America/Chicago',
          themeColor: '#AA3366',
          status: 'ACTIVE',
          archived: false,
        },
      ]);
    });

    it('returns the sign-up email as the contact email', async () => {
      const c = await company();
      expect((await profiles.get(c.sugrpay, c.sugrpay.merchantId)).company.contactEmail).toBe(
        c.email,
      );
    });

    it('returns a Brand with no Theme Color without one', async () => {
      const c = await company();
      await brands.add(c.hq, brandInput('Plain'));

      const plain = (await profiles.get(c.hq, c.hq.merchantId)).brands.find(
        (b) => b.displayName === 'Plain',
      );

      expect(plain?.themeColor).toBeNull();
    });

    it("returns all of the Company's Brands to the Company Admin, and only assigned ones to others", async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));
      await brands.add(c.hq, brandInput('Third'));
      const mate = await member(c.hq, [second.id]);

      expect((await profiles.get(c.hq, c.hq.merchantId)).brands).toHaveLength(3);
      expect(
        (await profiles.get(mate.hq, mate.hq.merchantId)).brands.map((b) => b.displayName),
      ).toEqual(['Second']);
    });

    it('returns the Company and no Brands to a user with none assigned', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);
      await owner.userBrandAssignment.deleteMany({ where: { userId: mate.id } });

      const profile = await profiles.get(mate.hq, mate.hq.merchantId);

      expect(profile.company.id).toBe(c.hq.merchantId);
      expect(profile.brands).toEqual([]);
    });

    it('returns an archived Brand marked as archived', async () => {
      const c = await company();
      await brands.archive(c.hq, c.firstBrandId);

      const [brand] = (await profiles.get(c.hq, c.hq.merchantId)).brands;

      expect(brand).toMatchObject({ status: 'ARCHIVED', archived: true });
    });

    it("returns neither the user's role nor Locations", async () => {
      const c = await company();
      await owner.location.create({
        data: {
          merchantId: c.hq.merchantId,
          brandId: c.firstBrandId,
          name: 'Store',
          kind: 'STORE',
        },
      });

      const profile = await profiles.get(c.hq, c.hq.merchantId);

      expect(Object.keys(profile).sort()).toEqual(['brands', 'company']);
      expect(JSON.stringify(profile)).not.toMatch(/role|location/i);
    });

    it('returns the latest details, Brands and Brand access', async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));
      const mate = await member(c.hq, [c.firstBrandId]);

      await brands.edit(c.hq, c.firstBrandId, { ...brandInput('Renamed') });
      await users.edit(c.hq, mate.id, {
        name: 'Team Member',
        email: mate.email,
        phone: US_PHONE,
        role: 'MANAGER',
        brandIds: [second.id],
      });

      expect((await profiles.get(c.hq, c.hq.merchantId)).brands.map((b) => b.displayName)).toEqual([
        'Renamed',
        'Second',
      ]);
      const fresh = await resolve(mate.token);
      expect((await profiles.get(fresh, fresh.merchantId)).brands.map((b) => b.id)).toEqual([
        second.id,
      ]);
    });

    it("refuses another Company's ID and returns nothing", async () => {
      const a = await company();
      const b = await company();

      const { error, code } = await failureOf(profiles.get(a.hq, b.hq.merchantId));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(code).toBe('NOT_YOUR_COMPANY');
    });
  });

  // --- Brand Management --------------------------------------------------

  describe('Brand Management', () => {
    it('adds a Brand with every detail, active, and returns its ID, Display Name and status', async () => {
      const c = await company();

      const added = await brands.add(c.hq, { ...brandInput('Coffee Bar'), themeColor: '#123456' });

      expect(added).toEqual({
        id: expect.any(String),
        displayName: 'Coffee Bar',
        status: 'ACTIVE',
      });
      const row = await owner.brand.findUniqueOrThrow({ where: { id: added.id } });
      expect(row).toMatchObject({
        merchantId: c.hq.merchantId,
        legalName: 'Coffee Bar LLC',
        currency: 'USD',
        timezone: 'America/Chicago',
        themeColor: '#123456',
      });
    });

    it('adds a Brand without a Theme Color', async () => {
      const c = await company();
      const added = await brands.add(c.hq, brandInput());
      expect(
        (await owner.brand.findUniqueOrThrow({ where: { id: added.id } })).themeColor,
      ).toBeNull();
    });

    it('refuses a Display Name already used in the Company, ignoring case and spacing', async () => {
      const c = await company();

      const { code, field } = await failureOf(brands.add(c.hq, brandInput('  flagship ')));

      expect(code).toBe('DISPLAY_NAME_TAKEN');
      expect(field).toBe('displayName');
      expect(await owner.brand.count({ where: { merchantId: c.hq.merchantId } })).toBe(1);
    });

    it('accepts a Display Name another Company uses', async () => {
      await company();
      const c = await company();
      await expect(brands.add(c.hq, brandInput('Flagship Two'))).resolves.toBeDefined();
      const other = await company();
      await expect(brands.add(other.hq, brandInput('Flagship Two'))).resolves.toBeDefined();
    });

    it('adds more Brands, even when the Company chose a single brand', async () => {
      const c = await company();

      await brands.add(c.hq, brandInput('Second'));
      await brands.add(c.hq, brandInput('Third'));

      expect(await owner.brand.count({ where: { merchantId: c.hq.merchantId } })).toBe(3);
    });

    it('creates no Brand when a Company is registered', async () => {
      const signedUp = await auth.register(
        { email: newEmail(), password: PASSWORD },
        { sourceIp: null, userAgent: null },
      );
      const scope = await resolve(signedUp.token);
      await merchants.registerCompany(scope, {
        companyName: `Empty Co ${run()}`,
        legalName: 'Empty Co LLC',
        taxId: '11-1111111',
        brandStructure: 'MULTI',
      });
      expect(await owner.brand.count({ where: { merchantId: scope.merchantId } })).toBe(0);
    });

    it('edits a Brand and returns it; keeping its own Display Name is fine', async () => {
      const c = await company();

      const edited = await brands.edit(c.hq, c.firstBrandId, {
        legalName: 'Flagship Holdings LLC',
        displayName: 'Flagship',
        currency: 'EUR',
        timezone: 'Europe/Berlin',
        themeColor: '#00AA00',
      });

      expect(edited).toMatchObject({
        id: c.firstBrandId,
        legalName: 'Flagship Holdings LLC',
        displayName: 'Flagship',
        currency: 'EUR',
        timezone: 'Europe/Berlin',
        themeColor: '#00AA00',
      });
    });

    it("refuses renaming a Brand to another Brand's Display Name", async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));

      const { code } = await failureOf(brands.edit(c.hq, second.id, brandInput('Flagship')));

      expect(code).toBe('DISPLAY_NAME_TAKEN');
      expect((await owner.brand.findUniqueOrThrow({ where: { id: second.id } })).displayName).toBe(
        'Second',
      );
    });

    it('archives a Brand', async () => {
      const c = await company();
      const archived = await brands.archive(c.hq, c.firstBrandId);
      expect(archived).toMatchObject({ status: 'ARCHIVED', archived: true });
    });

    it('refuses anyone but the Company Admin, and no Brand changes', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);

      for (const attempt of [
        () => brands.add(mate.hq, brandInput()),
        () => brands.edit(mate.hq, c.firstBrandId, brandInput('Changed')),
        () => brands.archive(mate.hq, c.firstBrandId),
      ]) {
        expect((await failureOf(attempt)).error).toBeInstanceOf(ForbiddenException);
      }
      const row = await owner.brand.findUniqueOrThrow({ where: { id: c.firstBrandId } });
      expect(row).toMatchObject({ displayName: 'Flagship', status: 'ACTIVE' });
      expect(await owner.brand.count({ where: { merchantId: c.hq.merchantId } })).toBe(1);
    });

    it("refuses editing or archiving another Company's Brand, which does not change", async () => {
      const a = await company();
      const b = await company();

      for (const attempt of [
        () => brands.edit(a.hq, b.firstBrandId, brandInput('Taken Over')),
        () => brands.archive(a.hq, b.firstBrandId),
      ]) {
        expect((await failureOf(attempt)).error).toBeInstanceOf(NotFoundException);
      }
      const row = await owner.brand.findUniqueOrThrow({ where: { id: b.firstBrandId } });
      expect(row).toMatchObject({ displayName: 'Flagship', status: 'ACTIVE' });
    });
  });

  // --- User Management ---------------------------------------------------

  describe('User Management — Users, Roles & Access', () => {
    it('adds an active user to the Company and returns every detail', async () => {
      const c = await company();
      const email = newEmail();

      const added = await users.add(c.hq, {
        name: 'Riley Stone',
        email,
        phone: US_PHONE,
        password: PASSWORD,
        role: 'EXECUTIVE',
        brandIds: [c.firstBrandId],
      });

      expect(added).toEqual({
        id: expect.any(String),
        name: 'Riley Stone',
        email,
        phone: { country: 'US', countryCode: '+1', number: '2025550143', e164: '+12025550143' },
        role: 'EXECUTIVE',
        brands: [{ id: c.firstBrandId, displayName: 'Flagship', archived: false }],
        status: 'ACTIVE',
      });
      const row = await owner.user.findUniqueOrThrow({ where: { id: added.id } });
      expect(row.merchantId).toBe(c.hq.merchantId);
    });

    it('refuses a Brand of another Company', async () => {
      const a = await company();
      const b = await company();

      const { code, field } = await failureOf(
        users.add(a.hq, {
          name: 'X',
          email: newEmail(),
          phone: US_PHONE,
          password: PASSWORD,
          role: 'MANAGER',
          brandIds: [b.firstBrandId],
        }),
      );

      expect([code, field]).toEqual(['BRAND_NOT_IN_COMPANY', 'brandIds']);
    });

    it('refuses an email that already has an account, in any Company and any case', async () => {
      const a = await company();
      const b = await company();

      const { code, field } = await failureOf(
        users.add(b.hq, {
          name: 'X',
          email: a.email.toUpperCase().toLowerCase(),
          phone: US_PHONE,
          password: PASSWORD,
          role: 'MANAGER',
          brandIds: [b.firstBrandId],
        }),
      );

      expect([code, field]).toEqual(['EMAIL_TAKEN', 'email']);
    });

    it('refuses a phone number that is not valid for its country', async () => {
      const c = await company();

      const { code, field } = await failureOf(
        users.add(c.hq, {
          name: 'X',
          email: newEmail(),
          phone: { country: 'GB', number: '(202) 555-0143' },
          password: PASSWORD,
          role: 'MANAGER',
          brandIds: [c.firstBrandId],
        }),
      );

      expect([code, field]).toEqual(['PHONE_INVALID', 'phone']);
    });

    it('refuses a role the platform does not provide for the asking product', async () => {
      const c = await company();
      for (const [scope, role] of [
        [c.hq, 'FINANCE_USER'],
        [c.sugrpay, 'EXECUTIVE'],
        [c.sugrpay, 'MERCHANT_OWNER'],
      ] as const) {
        const { code, field } = await failureOf(
          users.add(scope, {
            name: 'X',
            email: newEmail(),
            phone: US_PHONE,
            password: PASSWORD,
            role,
            brandIds: [c.firstBrandId],
          }),
        );
        expect([code, field]).toEqual(['ROLE_NOT_AVAILABLE', 'role']);
      }
    });

    it('lets the added user sign in with the password the Company Admin set', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);

      await expect(signIn(mate.email)).resolves.toMatchObject({ token: expect.any(String) });
    });

    it("edits a user's details, role and Brand access, and the product sees the change", async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));
      const mate = await member(c.hq, [c.firstBrandId]);
      const newAddress = newEmail();

      const edited = await users.edit(c.hq, mate.id, {
        name: 'Renamed Member',
        email: newAddress,
        phone: { country: 'GB', number: '020 7946 0958' },
        role: 'ASSOCIATE',
        brandIds: [second.id],
      });

      expect(edited).toMatchObject({
        name: 'Renamed Member',
        email: newAddress,
        phone: { country: 'GB', countryCode: '+44' },
        role: 'ASSOCIATE',
        brands: [{ id: second.id }],
      });
      const fresh = await resolve(mate.token);
      expect((await productSessions.details(fresh)).role).toBe('ASSOCIATE');
      expect((await profiles.get(fresh, fresh.merchantId)).brands.map((b) => b.id)).toEqual([
        second.id,
      ]);
    });

    it('refuses changing the email to one that already has an account', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);

      const { code } = await failureOf(
        users.edit(c.hq, mate.id, {
          name: 'Team Member',
          email: c.email,
          phone: US_PHONE,
          role: 'MANAGER',
          brandIds: [c.firstBrandId],
        }),
      );

      expect(code).toBe('EMAIL_TAKEN');
      expect((await owner.user.findUniqueOrThrow({ where: { id: mate.id } })).email).toBe(
        mate.email,
      );
    });

    it("sets Sugrpay's role as the platform role too, and leaves other products' roles alone", async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId], 'MANAGER');

      await users.edit(c.sugrpay, mate.id, {
        name: 'Team Member',
        email: mate.email,
        phone: US_PHONE,
        role: 'FINANCE_USER',
        brandIds: [c.firstBrandId],
      });

      const row = await owner.user.findUniqueOrThrow({
        where: { id: mate.id },
        include: { productRoles: true },
      });
      expect(row.role).toBe('FINANCE_USER');
      expect(Object.fromEntries(row.productRoles.map((r) => [r.product, r.role]))).toEqual({
        HQ: 'MANAGER',
        INVOICING: 'FINANCE_USER',
      });
    });

    it('deactivates a user: they cannot sign in, their JWT stops, their records stay', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);

      const result = await users.deactivate(c.hq, mate.id);

      expect(result.status).toBe('DEACTIVATED');
      expect((await failureOf(signIn(mate.email))).error).toBeInstanceOf(UnauthorizedException);
      expect(
        await sessions.resolve((await products.continueInto(c.hq, 'HQ')).token, null),
      ).not.toBeNull();
      const row = await owner.user.findUnique({
        where: { id: mate.id },
        include: { assignments: true, productRoles: true },
      });
      expect(row).toMatchObject({ status: 'SUSPENDED' });
      expect(row!.assignments).toHaveLength(1);
      expect(row!.productRoles).toHaveLength(1);
    });

    it('reactivates a user, who can sign in again', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);
      await users.deactivate(c.hq, mate.id);

      expect((await users.reactivate(c.hq, mate.id)).status).toBe('ACTIVE');
      await expect(signIn(mate.email)).resolves.toBeDefined();
    });

    it('refuses the Company Admin deactivating their own account', async () => {
      const c = await company();

      const { code } = await failureOf(users.deactivate(c.hq, c.hq.userId));

      expect(code).toBe('CANNOT_DEACTIVATE_SELF');
      expect((await owner.user.findUniqueOrThrow({ where: { id: c.hq.userId } })).status).toBe(
        'ACTIVE',
      );
    });

    it('refuses anyone but the Company Admin, and no user changes', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);
      const other = await member(c.hq, [c.firstBrandId]);
      const input = {
        name: 'X',
        email: newEmail(),
        phone: US_PHONE,
        role: 'MANAGER',
        brandIds: [c.firstBrandId],
      };

      for (const attempt of [
        () => users.add(mate.hq, { ...input, password: PASSWORD }),
        () => users.edit(mate.hq, other.id, input),
        () => users.deactivate(mate.hq, other.id),
        () => users.reactivate(mate.hq, other.id),
      ]) {
        expect((await failureOf(attempt)).error).toBeInstanceOf(ForbiddenException);
      }
      const row = await owner.user.findUniqueOrThrow({ where: { id: other.id } });
      expect(row).toMatchObject({ email: other.email, status: 'ACTIVE' });
    });

    it("refuses editing or deactivating another Company's user, who does not change", async () => {
      const a = await company();
      const b = await company();
      const theirs = await member(b.hq, [b.firstBrandId]);

      for (const attempt of [
        () =>
          users.edit(a.hq, theirs.id, {
            name: 'Taken',
            email: theirs.email,
            phone: US_PHONE,
            role: 'MANAGER',
            brandIds: [a.firstBrandId],
          }),
        () => users.deactivate(a.hq, theirs.id),
      ]) {
        expect((await failureOf(attempt)).error).toBeInstanceOf(NotFoundException);
      }
      const row = await owner.user.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(row).toMatchObject({ name: 'Team Member', status: 'ACTIVE' });
    });
  });

  // --- User List ---------------------------------------------------------

  describe('User Management — User List', () => {
    it("returns the Company's users, each with its details and the asking product's role only", async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId], 'MANAGER');
      await users.edit(c.sugrpay, mate.id, {
        name: 'Team Member',
        email: mate.email,
        phone: US_PHONE,
        role: 'SALES_USER',
        brandIds: [c.firstBrandId],
      });

      const hqList = await users.list(c.hq, {});
      const sugrpayList = await users.list(c.sugrpay, {});

      expect(hqList.map((u) => u.id).sort()).toEqual([c.hq.userId, mate.id].sort());
      expect(hqList.find((u) => u.id === mate.id)).toMatchObject({
        name: 'Team Member',
        email: mate.email,
        phone: { country: 'US', e164: '+12025550143' },
        role: 'MANAGER',
        brands: [{ id: c.firstBrandId }],
        status: 'ACTIVE',
      });
      expect(sugrpayList.find((u) => u.id === mate.id)!.role).toBe('SALES_USER');
    });

    it('returns a deactivated user marked as deactivated', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);
      await users.deactivate(c.hq, mate.id);

      expect((await users.list(c.hq, {})).find((u) => u.id === mate.id)!.status).toBe(
        'DEACTIVATED',
      );
    });

    it('returns the Company Admin with every Brand, and under every Brand', async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));

      const all = await users.list(c.hq, {});
      expect(all.find((u) => u.id === c.hq.userId)).toMatchObject({
        role: 'COMPANY_ADMIN',
        brands: [{ id: c.firstBrandId }, { id: second.id }],
      });
      for (const brandId of [c.firstBrandId, second.id]) {
        expect((await users.list(c.hq, { brandId })).map((u) => u.id)).toContain(c.hq.userId);
      }
    });

    it('filters by Brand, showing a user under each of their Brands', async () => {
      const c = await company();
      const second = await brands.add(c.hq, brandInput('Second'));
      const third = await brands.add(c.hq, brandInput('Third'));
      const onFirst = await member(c.hq, [c.firstBrandId]);
      const onBoth = await member(c.hq, [c.firstBrandId, second.id]);

      const ids = async (brandId: string) =>
        (await users.list(c.hq, { brandId })).map((u) => u.id).sort();

      expect(await ids(c.firstBrandId)).toEqual([c.hq.userId, onFirst.id, onBoth.id].sort());
      expect(await ids(second.id)).toEqual([c.hq.userId, onBoth.id].sort());
      // A Brand with nobody else assigned: just the Company Admin, not an error.
      expect(await ids(third.id)).toEqual([c.hq.userId]);
    });

    it("refuses filtering by another Company's Brand, and returns no users", async () => {
      const a = await company();
      const b = await company();

      expect((await failureOf(users.list(a.hq, { brandId: b.firstBrandId }))).error).toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns only the signed-in Company's users", async () => {
      const a = await company();
      const b = await company();
      await member(b.hq, [b.firstBrandId]);

      const listed = await users.list(a.hq, {});

      expect(listed.map((u) => u.id)).toEqual([a.hq.userId]);
    });

    it('refuses anyone but the Company Admin', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);

      expect((await failureOf(users.list(mate.hq, {}))).error).toBeInstanceOf(ForbiddenException);
    });
  });

  // --- Role List ---------------------------------------------------------

  describe('Role Management — Role List', () => {
    it("returns the asking product's roles only, each with its ID and name, without the Company Admin", async () => {
      const c = await company();

      expect(roles.list(c.hq)).toEqual([
        { id: 'EXECUTIVE', name: 'Executive' },
        { id: 'MANAGER', name: 'Manager' },
        { id: 'ASSOCIATE', name: 'Associate' },
      ]);
      expect(roles.list(c.sugrpay)).toEqual([
        { id: 'MERCHANT_ADMIN', name: 'Admin' },
        { id: 'BRAND_ADMIN', name: 'Brand Admin' },
        { id: 'FINANCE_USER', name: 'Finance User' },
        { id: 'SALES_USER', name: 'Sales User' },
        { id: 'READ_ONLY', name: 'Read Only' },
      ]);
    });

    it('returns the same roles for every Company', async () => {
      const a = await company();
      const b = await company();
      expect(roles.list(a.hq)).toEqual(roles.list(b.hq));
    });

    it('accepts a returned role when adding a user', async () => {
      const c = await company();
      for (const role of roles.list(c.hq)) {
        const added = await users.add(c.hq, {
          name: 'X',
          email: newEmail(),
          phone: US_PHONE,
          password: PASSWORD,
          role: role.id,
          brandIds: [c.firstBrandId],
        });
        expect(added.role).toBe(role.id);
      }
    });

    it('refuses anyone but the Company Admin', async () => {
      const c = await company();
      const mate = await member(c.hq, [c.firstBrandId]);
      expect((await failureOf(() => roles.list(mate.hq))).error).toBeInstanceOf(ForbiddenException);
    });
  });

  it("asks for the product's JWT on every endpoint: a platform session has no asking product", async () => {
    const c = await company();
    for (const attempt of [
      () => profiles.get(c.admin, c.admin.merchantId),
      () => brands.add(c.admin, brandInput()),
      () => users.list(c.admin, {}),
      () => roles.list(c.admin),
    ]) {
      expect((await failureOf(attempt)).code).toBe('PRODUCT_TOKEN_REQUIRED');
    }
  });
});
