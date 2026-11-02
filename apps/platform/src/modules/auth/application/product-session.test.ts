/**
 * Product Session — User Details & Tokens, end to end against the real
 * platform database (docs/product/stories/product-session.md). One test per
 * acceptance scenario, plus the edges each rule has. The JWT is resolved
 * exactly as the request guard resolves it (SessionService.resolve).
 */
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { SignJWT, decodeJwt } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import type { Product, RequestScope } from '@platform/kernel';
import {
  createFakeMailPort,
  EventBus,
  getEnv,
  loadEnv,
  OutboxDispatcher,
  productScope,
  type Env,
  type RedisService,
} from '@platform/server';
import { PrismaClient } from '../../database/client.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import { MerchantService } from '../../companies/application/merchant.service.js';
import { ProductsService } from '../../subscriptions/application/products.service.js';
import { SubscriptionsService } from '../../subscriptions/application/subscriptions.service.js';
import { hashPassword } from '../infrastructure/password.js';
import { AuthMailService } from './auth-mail.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { ProductSessionService } from './product-session.service.js';
import { SessionService } from './session.service.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL']);
const baseEnv = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const JWT_SECRET = 'test-product-jwt-secret-0123456789abcdef';
const TWELVE_HOURS = 12 * 60 * 60;

describeWithDb('Product Session', () => {
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
  const owner = new PrismaClient({
    datasources: { db: { url: env.PLATFORM_DIRECT_DATABASE_URL ?? env.PLATFORM_DATABASE_URL } },
  });
  const emails: string[] = [];

  const run = () => randomUUID().slice(0, 8);
  const newEmail = () => {
    const email = `session-${run()}@product-session-test.test`;
    emails.push(email);
    return email;
  };
  const resolve = (token: string) => sessions.resolve(token, null);
  const scopeOf = async (token: string): Promise<RequestScope> => {
    const scope = await resolve(token);
    if (!scope) throw new Error('token did not resolve');
    return scope;
  };
  /** A Company Admin whose company has both products enabled. */
  const company = async (enable: Product[] = ['INVOICING', 'HQ']) => {
    const email = newEmail();
    const signedUp = await auth.register(
      { email, password: PASSWORD },
      { sourceIp: null, userAgent: null },
    );
    const scope = await scopeOf(signedUp.token);
    const companyName = `Session Co ${run()}`;
    await merchants.registerCompany(scope, {
      companyName,
      legalName: `${companyName} LLC`,
      taxId: '12-3456789',
      brandStructure: 'SINGLE',
    });
    await merchants.addFirstBrand(scope, {
      legalName: 'Acme Coffee LLC',
      displayName: 'Acme Coffee',
      currency: 'USD',
      timezone: 'America/New_York',
    });
    await products.enable(scope, enable);
    return { scope: await scopeOf(signedUp.token), email };
  };
  /** Another user of the company, with a different role in each product. */
  const teammate = async (scope: RequestScope) => {
    const email = newEmail();
    const user = await owner.user.create({
      data: {
        merchantId: scope.merchantId,
        email,
        name: 'Team Mate',
        passwordHash: await hashPassword(PASSWORD),
        role: 'FINANCE_USER',
        status: 'ACTIVE',
        productRoles: {
          create: [
            { product: 'INVOICING', role: 'FINANCE_USER' },
            { product: 'HQ', role: 'MANAGER' },
          ],
        },
      },
    });
    const { token } = await sessions.issue(user.id);
    return { user, scope: await scopeOf(token) };
  };
  const failureOf = async (work: Promise<unknown>) => {
    const error = await work.then(
      () => null,
      (e: unknown) => e as { getStatus?: () => number; getResponse?: () => unknown },
    );
    if (!error) throw new Error('expected the call to fail');
    const body = error.getResponse?.() as { code?: string } | undefined;
    return { status: error.getStatus?.(), code: body?.code };
  };
  const forge = (claims: Record<string, unknown>, secret = JWT_SECRET, ttl = TWELVE_HOURS) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims as Record<string, string>)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('platform')
      .setIssuedAt(now - TWELVE_HOURS - 60)
      .setExpirationTime(now - TWELVE_HOURS - 60 + ttl)
      .sign(new TextEncoder().encode(secret));
  };

  afterAll(async () => {
    const users = await owner.user.findMany({ where: { email: { in: emails } } });
    await owner.merchant.deleteMany({ where: { id: { in: users.map((u) => u.merchantId) } } });
    await owner.$disconnect();
    await prisma.$disconnect();
  });

  it('sends the user into the product with a 12-hour JWT naming the user and the Company, and a refresh token', async () => {
    const { scope } = await company();

    const launch = await products.continueInto(scope, 'HQ');

    expect(launch.url).toBe('https://hq.example.test');
    const claims = decodeJwt(launch.token);
    expect(claims.sub).toBe(scope.userId);
    expect(claims['mid']).toBe(scope.merchantId);
    expect(claims.aud).toBe('HQ');
    expect(claims.exp! - claims.iat!).toBe(TWELVE_HOURS);
    expect(new Date(launch.expiresAt).getTime()).toBe(claims.exp! * 1000);
    expect(launch.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(launch.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3);
  });

  it("returns the user's details, the Company ID, the role and the JWT's expiry from the JWT alone", async () => {
    const { scope, email } = await company();
    const launch = await products.continueInto(scope, 'INVOICING');

    const details = await productSessions.details(await scopeOf(launch.token));

    expect(details).toEqual({
      user: { id: scope.userId, name: expect.any(String), email },
      companyId: scope.merchantId,
      product: 'INVOICING',
      role: 'COMPANY_ADMIN',
      expiresAt: launch.expiresAt,
    });
  });

  it('returns Company Admin as the role for the Company Admin, in every product', async () => {
    const { scope } = await company();
    for (const product of ['INVOICING', 'HQ'] as const) {
      const { token } = await products.continueInto(scope, product);
      expect((await productSessions.details(await scopeOf(token))).role).toBe('COMPANY_ADMIN');
    }
  });

  it("returns only the asking product's role for any other user", async () => {
    const { scope } = await company();
    const mate = await teammate(scope);

    const sugrpay = await products.continueInto(mate.scope, 'INVOICING');
    const hq = await products.continueInto(mate.scope, 'HQ');

    expect((await productSessions.details(await scopeOf(sugrpay.token))).role).toBe('FINANCE_USER');
    expect((await productSessions.details(await scopeOf(hq.token))).role).toBe('MANAGER');
  });

  it('returns the latest role after the Company Admin changes it', async () => {
    const { scope } = await company();
    const mate = await teammate(scope);
    const { token } = await products.continueInto(mate.scope, 'HQ');

    await owner.userProductRole.update({
      where: { userId_product: { userId: mate.user.id, product: 'HQ' } },
      data: { role: 'ASSOCIATE' },
    });

    expect((await productSessions.details(await scopeOf(token))).role).toBe('ASSOCIATE');
  });

  it("does not return the Company's details or Brands", async () => {
    const { scope } = await company();
    const { token } = await products.continueInto(scope, 'HQ');

    const details = await productSessions.details(await scopeOf(token));

    expect(Object.keys(details).sort()).toEqual([
      'companyId',
      'expiresAt',
      'product',
      'role',
      'user',
    ]);
  });

  it('accepts the JWT on platform calls within 12 hours, for that user', async () => {
    const { scope } = await company();
    const { token } = await products.continueInto(scope, 'HQ');

    const resolved = await scopeOf(token);

    expect(resolved).toMatchObject({
      userId: scope.userId,
      merchantId: scope.merchantId,
      role: 'MERCHANT_OWNER',
      tokenProduct: 'HQ',
    });
  });

  it('refuses an expired JWT', async () => {
    const { scope } = await company();
    const { token } = await products.continueInto(scope, 'HQ');
    const sid = decodeJwt(token)['sid'];

    const expired = await forge({ mid: scope.merchantId, sid, sub: scope.userId, aud: 'HQ' });

    expect(await resolve(expired)).toBeNull();
  });

  it('refuses a JWT that is not valid, and returns nothing', async () => {
    const { scope } = await company();
    const { token } = await products.continueInto(scope, 'HQ');
    const sid = decodeJwt(token)['sid'];
    const [header, payload] = token.split('.');

    const tampered = `${header}.${payload}.${'A'.repeat(43)}`;
    const wrongSecret = await forge(
      { mid: scope.merchantId, sid, sub: scope.userId, aud: 'HQ' },
      'some-other-secret-0123456789abcdefghij',
      TWELVE_HOURS * 3,
    );
    const otherUser = await forge(
      { mid: scope.merchantId, sid, sub: randomUUID(), aud: 'HQ' },
      JWT_SECRET,
      TWELVE_HOURS * 3,
    );
    const otherProduct = await forge(
      { mid: scope.merchantId, sid, sub: scope.userId, aud: 'INVOICING' },
      JWT_SECRET,
      TWELVE_HOURS * 3,
    );

    for (const bad of [tampered, wrongSecret, otherUser, otherProduct, 'not.a.jwt']) {
      expect(await resolve(bad)).toBeNull();
    }
  });

  it('refreshes an expired JWT with the refresh token: a new 12-hour JWT, no sign-in', async () => {
    const { scope } = await company();
    const launch = await products.continueInto(scope, 'HQ');

    const refreshed = await productSessions.refresh(launch.refreshToken);

    const claims = decodeJwt(refreshed.token);
    expect(claims.exp! - claims.iat!).toBe(TWELVE_HOURS);
    expect(claims.sub).toBe(scope.userId);
    expect(claims.aud).toBe('HQ');
    expect(new Date(refreshed.expiresAt).getTime()).toBe(claims.exp! * 1000);
    expect((await productSessions.details(await scopeOf(refreshed.token))).role).toBe(
      'COMPANY_ADMIN',
    );
  });

  it('issues no JWT for an expired refresh token; the user must sign in again', async () => {
    const { scope } = await company();
    const launch = await products.continueInto(scope, 'HQ');
    const sid = decodeJwt(launch.token)['sid'] as string;
    await owner.session.update({
      where: { id: sid },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await failureOf(productSessions.refresh(launch.refreshToken))).toEqual({
      status: 401,
      code: 'SIGN_IN_REQUIRED',
    });
    // The JWT of an ended session stops working too.
    expect(await resolve(launch.token)).toBeNull();
  });

  it('issues no JWT for a refresh token that is not valid', async () => {
    const { scope } = await company();
    const platformSession = await sessions.issue(scope.userId);
    const launch = await products.continueInto(scope, 'HQ');
    await owner.session.update({
      where: { id: decodeJwt(launch.token)['sid'] as string },
      data: { revokedAt: new Date() },
    });

    for (const bad of ['0'.repeat(64), platformSession.token, launch.refreshToken]) {
      expect(await failureOf(productSessions.refresh(bad))).toEqual({
        status: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
    }
  });

  it('never accepts the refresh token itself for a platform call', async () => {
    const { scope } = await company();
    const launch = await products.continueInto(scope, 'HQ');

    expect(await resolve(launch.refreshToken)).toBeNull();
  });

  it('refuses the call, and refresh, once the product is not enabled for the Company', async () => {
    const { scope } = await company();
    const launch = await products.continueInto(scope, 'HQ');

    await owner.subscription.updateMany({
      where: { merchantId: scope.merchantId, product: 'HQ' },
      data: { status: 'CANCELLED' },
    });

    expect(await resolve(launch.token)).toBeNull();
    expect((await failureOf(productSessions.refresh(launch.refreshToken))).status).toBe(401);
  });

  it('refuses a suspended user', async () => {
    const { scope } = await company();
    const mate = await teammate(scope);
    const launch = await products.continueInto(mate.scope, 'HQ');

    await owner.user.update({ where: { id: mate.user.id }, data: { status: 'SUSPENDED' } });

    expect(await resolve(launch.token)).toBeNull();
    expect((await failureOf(productSessions.refresh(launch.refreshToken))).status).toBe(401);
  });

  it("asks for the product's JWT: a platform session has no asking product", async () => {
    const { scope } = await company();

    expect(await failureOf(productSessions.details(scope))).toEqual({
      status: 403,
      code: 'PRODUCT_TOKEN_REQUIRED',
    });
  });

  it("keeps a product's JWT to that product's own endpoints", async () => {
    const { scope } = await company();
    const { token } = await products.continueInto(scope, 'HQ');
    const hqScope = await scopeOf(token);

    expect(() => productScope(hqScope, 'INVOICING')).toThrow(ForbiddenException);
    expect(productScope(hqScope, 'HQ').product).toBe('HQ');
  });
});
