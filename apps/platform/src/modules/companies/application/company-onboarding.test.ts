/**
 * Company onboarding, end to end against the real platform database
 * (docs/product/stories/company-onboarding.md): Sign Up, Sign In and Forgot
 * Password; Register Your Company; Add Your Brand; Select Your Products &
 * Redirect. One test per acceptance scenario, plus the edges each rule has.
 * Request validation (missing fields, formats) is covered by the schemas'
 * own tests in packages/platform-contracts.
 */
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestScope } from '@platform/kernel';
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
import { SessionService } from '../../auth/application/session.service.js';
import { hashPassword } from '../../auth/infrastructure/password.js';
import { ProductsService } from '../../subscriptions/application/products.service.js';
import { SubscriptionsService } from '../../subscriptions/application/subscriptions.service.js';
import { MerchantService } from './merchant.service.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL']);
const baseEnv = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const JWT_SECRET = 'test-product-jwt-secret-0123456789abcdef';

describeWithDb('company onboarding', () => {
  const env = { ...baseEnv!, PRODUCT_JWT_SECRET: JWT_SECRET, HQ_PUBLIC_URL: undefined } as Env;
  const prisma = new PlatformPrismaService(env);
  const mail = createFakeMailPort();
  const redis = { acquireGenericRateToken: async () => true } as unknown as RedisService;
  const sessions = new SessionService(prisma);
  const auth = new AuthService(
    prisma,
    sessions,
    new PasswordResetService(prisma),
    new AuthMailService(mail, env),
    redis,
  );
  const outbox = new PlatformOutbox(prisma, new OutboxDispatcher(new EventBus(), env));
  const merchants = new MerchantService(prisma, outbox);
  const subscriptions = new SubscriptionsService(prisma, outbox);
  const products = new ProductsService(prisma, outbox, subscriptions, env);
  const owner = new PrismaClient({
    datasources: { db: { url: env.PLATFORM_DIRECT_DATABASE_URL ?? env.PLATFORM_DATABASE_URL } },
  });
  const context = { sourceIp: '127.0.0.1', userAgent: 'vitest' };
  const emails: string[] = [];
  const names: string[] = [];

  const run = () => randomUUID().slice(0, 8);
  const newEmail = (domain = 'onboarding-test.test') => {
    const email = `admin-${run()}@${domain}`;
    emails.push(email);
    return email;
  };
  const newCompanyName = () => {
    const name = `Onboarding Co ${run()}`;
    names.push(name);
    return name;
  };
  const scopeOf = async (token: string): Promise<RequestScope> => {
    const scope = await sessions.resolve(token, null);
    if (!scope) throw new Error('session did not resolve');
    return scope;
  };
  const signUp = async (email = newEmail()) => {
    const result = await auth.register({ email, password: PASSWORD }, context);
    return { ...result, scope: await scopeOf(result.token) };
  };
  const register = (scope: RequestScope, companyName = newCompanyName()) =>
    merchants.registerCompany(scope, {
      companyName,
      legalName: `${companyName} LLC`,
      taxId: '12-3456789',
      brandStructure: 'SINGLE',
    });
  const brand = {
    legalName: 'Acme Coffee LLC',
    displayName: 'Acme Coffee',
    currency: 'USD' as const,
    timezone: 'America/New_York',
  };
  const stepOf = async (scope: RequestScope) =>
    (await merchants.getOnboardingState(scope)).nextStep;
  /** A second user in the company: a Merchant Admin, not the Company Admin. */
  const addUser = async (scope: RequestScope) => {
    const user = await owner.user.create({
      data: {
        merchantId: scope.merchantId,
        email: newEmail(),
        name: 'Other User',
        passwordHash: await hashPassword(PASSWORD),
        role: 'MERCHANT_ADMIN',
        status: 'ACTIVE',
      },
    });
    const { token } = await sessions.issue(user.id, context);
    return scopeOf(token);
  };
  const errorOf = async (work: Promise<unknown>) => {
    const error = await work.then(
      () => null,
      (e: unknown) => e,
    );
    if (!error) throw new Error('expected the call to fail');
    return error as { getResponse?: () => unknown; constructor: unknown };
  };
  const codeOf = async (work: Promise<unknown>) => {
    const error = await errorOf(work);
    const body = error.getResponse?.() as { code?: string } | undefined;
    return body?.code;
  };

  beforeEach(() => {
    mail.outbox.length = 0;
  });

  afterAll(async () => {
    const users = await owner.user.findMany({ where: { email: { in: emails } } });
    await owner.merchant.deleteMany({ where: { id: { in: users.map((u) => u.merchantId) } } });
    await owner.$disconnect();
    await prisma.$disconnect();
  });

  // --- Sign Up -----------------------------------------------------------

  describe('Sign Up', () => {
    it('creates the account; the person is the Company Admin and goes to Register Your Company', async () => {
      const email = newEmail();
      const { scope, user } = await signUp(email);

      expect(user.role).toBe('MERCHANT_OWNER');
      expect(user.mustResetPassword).toBe(false);
      const row = await owner.user.findFirstOrThrow({
        where: { email },
        include: { merchant: { include: { subscriptions: true } }, productRoles: true },
      });
      expect(row.status).toBe('ACTIVE');
      expect(row.merchant.contactEmail).toBe(email);
      expect(row.merchant.companyEmail).toBe(email);
      // No product until Select Your Products.
      expect(row.merchant.subscriptions).toEqual([]);
      expect(row.productRoles).toEqual([]);
      expect(await stepOf(scope)).toBe('REGISTER_COMPANY');
    });

    it('refuses an email that already has an account, in any case, and creates nothing', async () => {
      const email = newEmail();
      await signUp(email);

      const code = await codeOf(
        auth.register({ email: email.toUpperCase(), password: PASSWORD }, context),
      );

      expect(code).toBe('EMAIL_TAKEN');
      expect(
        await owner.user.count({ where: { email: { equals: email, mode: 'insensitive' } } }),
      ).toBe(1);
    });

    it('refuses an email that belongs to a user in another company', async () => {
      const { scope } = await signUp();
      const other = await addUser(scope);
      const otherEmail = (await owner.user.findUniqueOrThrow({ where: { id: other.userId } }))
        .email;

      expect(await codeOf(auth.register({ email: otherEmail, password: PASSWORD }, context))).toBe(
        'EMAIL_TAKEN',
      );
    });

    it('lets two sign-ups race for one email, and only one wins', async () => {
      const email = newEmail();
      const outcomes = await Promise.allSettled([
        auth.register({ email, password: PASSWORD }, context),
        auth.register({ email, password: PASSWORD }, context),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await owner.user.count({ where: { email } })).toBe(1);
    });

    it('gives a different company email its own, separate company', async () => {
      const first = await signUp();
      const second = await signUp();

      expect(second.scope.merchantId).not.toBe(first.scope.merchantId);
    });
  });

  // --- Sign In -----------------------------------------------------------

  describe('Sign In', () => {
    const signIn = (email: string, password = PASSWORD) =>
      auth.login({ email, password, sourceIp: null, userAgent: null });

    it('takes the user to the first step not yet done', async () => {
      const email = newEmail();
      await signUp(email);
      const scopeAfter = async () => scopeOf((await signIn(email)).token);

      expect(await stepOf(await scopeAfter())).toBe('REGISTER_COMPANY');
      await register(await scopeAfter());
      expect(await stepOf(await scopeAfter())).toBe('ADD_BRAND');
      await merchants.addFirstBrand(await scopeAfter(), brand);
      expect(await stepOf(await scopeAfter())).toBe('SELECT_PRODUCTS');
      await products.enable(await scopeAfter(), ['INVOICING']);
      // After onboarding: Select Your Products is where every sign-in lands.
      expect(await stepOf(await scopeAfter())).toBe('SELECT_PRODUCTS');
    });

    it('refuses a wrong password and an unknown email the same way', async () => {
      const email = newEmail();
      await signUp(email);

      const wrong = await errorOf(signIn(email, 'not the password at all'));
      const unknown = await errorOf(signIn(`nobody-${run()}@onboarding-test.test`));

      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      const row = await owner.user.findFirstOrThrow({ where: { email } });
      expect(row.failedLogins).toBe(1);
    });

    it('locks the account for 2 hours on the fifth failure in a row, even against the right password', async () => {
      const email = newEmail();
      await signUp(email);

      for (let n = 1; n <= 4; n++) await errorOf(signIn(email, 'wrong password!!'));
      let row = await owner.user.findFirstOrThrow({ where: { email } });
      expect(row.failedLogins).toBe(4);
      expect(row.lockedUntil).toBeNull();

      await errorOf(signIn(email, 'wrong password!!'));
      row = await owner.user.findFirstOrThrow({ where: { email } });
      const lockedFor = row.lockedUntil!.getTime() - Date.now();
      expect(lockedFor).toBeGreaterThan(119 * 60_000);
      expect(lockedFor).toBeLessThanOrEqual(120 * 60_000 + 5_000);

      expect(await errorOf(signIn(email))).toBeInstanceOf(UnauthorizedException);
      const still = await owner.user.findFirstOrThrow({ where: { email } });
      expect(still.lockedUntil).toEqual(row.lockedUntil);
    });

    it('lets the user in once the lock has ended, and the count starts again', async () => {
      const email = newEmail();
      await signUp(email);
      await owner.user.updateMany({
        where: { email },
        data: { failedLogins: 5, lockedUntil: new Date(Date.now() - 1_000) },
      });

      await errorOf(signIn(email, 'wrong password!!'));
      const row = await owner.user.findFirstOrThrow({ where: { email } });
      expect(row.failedLogins).toBe(1);
      expect(row.lockedUntil).toBeNull();

      await expect(signIn(email)).resolves.toMatchObject({ user: { email } });
      const after = await owner.user.findFirstOrThrow({ where: { email } });
      expect(after.failedLogins).toBe(0);
    });

    it('counts two wrong passwords sent at the same moment as two', async () => {
      const email = newEmail();
      await signUp(email);

      await Promise.allSettled([
        signIn(email, 'wrong password!!'),
        signIn(email, 'wrong password!!'),
      ]);

      expect((await owner.user.findFirstOrThrow({ where: { email } })).failedLogins).toBe(2);
    });
  });

  // --- Forgot Password ---------------------------------------------------

  describe('Forgot Password', () => {
    it('emails a single-use link; the new password works and the old one stops', async () => {
      const email = newEmail();
      await signUp(email);

      await auth.requestPasswordReset(email, context);
      // Sent only to the address registered on the account.
      const sent = mail.outbox.filter((m) => m.to.includes(email));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toEqual([email]);
      const token = /[0-9a-f]{64}/.exec(`${sent[0]!.text ?? ''}${sent[0]!.html}`)?.[0];
      expect(token).toBeDefined();

      const newPassword = 'a brand new passphrase';
      await auth.setPasswordWithToken(token!, newPassword, context);

      await expect(
        auth.login({ email, password: newPassword, sourceIp: null, userAgent: null }),
      ).resolves.toBeDefined();
      await expect(
        auth.login({ email, password: PASSWORD, sourceIp: null, userAgent: null }),
      ).rejects.toThrow(UnauthorizedException);
      // Used once: the same link cannot set a password again.
      await expect(
        auth.setPasswordWithToken(token!, 'yet another passphrase', context),
      ).rejects.toThrow();
    });
  });

  // --- Register Your Company ---------------------------------------------

  describe('Register Your Company', () => {
    it('registers the company with the sign-up email as its contact email', async () => {
      const email = newEmail();
      const { scope } = await signUp(email);
      const companyName = newCompanyName();

      await expect(register(scope, companyName)).resolves.toEqual({ nextStep: 'ADD_BRAND' });

      const state = await merchants.getOnboardingState(scope);
      expect(state.company).toMatchObject({
        companyName,
        legalName: `${companyName} LLC`,
        taxId: '12-3456789',
        brandStructure: 'SINGLE',
        contactEmail: email,
      });
      expect(state.nextStep).toBe('ADD_BRAND');
    });

    it('accepts multiple brands as the structure too', async () => {
      const { scope } = await signUp();
      await merchants.registerCompany(scope, {
        companyName: newCompanyName(),
        legalName: 'Multi LLC',
        taxId: '98-7654321',
        brandStructure: 'MULTI',
      });
      expect((await merchants.getOnboardingState(scope)).company.brandStructure).toBe('MULTI');
    });

    it('refuses a name another company has, ignoring case and spacing', async () => {
      const first = await signUp();
      const name = newCompanyName();
      await register(first.scope, name);
      const second = await signUp();

      const code = await codeOf(
        register(second.scope, `  ${name.toUpperCase().replace(/ /g, '   ')} `),
      );

      expect(code).toBe('COMPANY_NAME_TAKEN');
      expect(await stepOf(second.scope)).toBe('REGISTER_COMPANY');
    });

    it('lets two companies race for one name, and only one gets it', async () => {
      const [a, b] = await Promise.all([signUp(), signUp()]);
      const name = newCompanyName();

      const outcomes = await Promise.allSettled([register(a.scope, name), register(b.scope, name)]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    });

    it('registers a company only once and leaves it unchanged', async () => {
      const { scope } = await signUp();
      const name = newCompanyName();
      await register(scope, name);

      expect(await codeOf(register(scope))).toBe('COMPANY_ALREADY_REGISTERED');
      expect((await merchants.getOnboardingState(scope)).company.companyName).toBe(name);
    });

    it('is only for the Company Admin', async () => {
      const { scope } = await signUp();
      const other = await addUser(scope);

      expect(await errorOf(register(other))).toBeInstanceOf(ForbiddenException);
    });
  });

  // --- Add Your Brand ----------------------------------------------------

  describe('Add Your Brand', () => {
    it('adds an active brand with every detail and goes on to Select Your Products', async () => {
      const { scope } = await signUp();
      await register(scope);

      const result = await merchants.addFirstBrand(scope, { ...brand, themeColor: '#AA3366' });

      expect(result.nextStep).toBe('SELECT_PRODUCTS');
      const row = await owner.brand.findUniqueOrThrow({ where: { id: result.brand.id } });
      expect(row).toMatchObject({
        merchantId: scope.merchantId,
        legalName: 'Acme Coffee LLC',
        displayName: 'Acme Coffee',
        currency: 'USD',
        timezone: 'America/New_York',
        themeColor: '#AA3366',
        status: 'ACTIVE',
        taxId: '12-3456789',
      });
    });

    it('adds the brand without a theme colour, with the default one', async () => {
      const { scope } = await signUp();
      await register(scope);

      const result = await merchants.addFirstBrand(scope, brand);

      const row = await owner.brand.findUniqueOrThrow({ where: { id: result.brand.id } });
      expect(row.themeColor).toBe('#2D6A6A');
    });

    it('adds one brand whichever brand structure was chosen', async () => {
      const { scope } = await signUp();
      await merchants.registerCompany(scope, {
        companyName: newCompanyName(),
        legalName: 'Multi LLC',
        taxId: '98-7654321',
        brandStructure: 'MULTI',
      });

      await merchants.addFirstBrand(scope, brand);

      expect(await codeOf(merchants.addFirstBrand(scope, brand))).toBe('BRAND_ALREADY_ADDED');
      expect(await owner.brand.count({ where: { merchantId: scope.merchantId } })).toBe(1);
    });

    it('is not reachable before the company is registered', async () => {
      const { scope } = await signUp();

      expect(await codeOf(merchants.addFirstBrand(scope, brand))).toBe('COMPANY_NOT_REGISTERED');
      expect(await owner.brand.count({ where: { merchantId: scope.merchantId } })).toBe(0);
    });

    it('adds only one brand when two submits arrive at once', async () => {
      const { scope } = await signUp();
      await register(scope);

      await Promise.allSettled([
        merchants.addFirstBrand(scope, brand),
        merchants.addFirstBrand(scope, brand),
      ]);

      expect(await owner.brand.count({ where: { merchantId: scope.merchantId } })).toBe(1);
    });

    it('is only for the Company Admin', async () => {
      const { scope } = await signUp();
      await register(scope);
      const other = await addUser(scope);

      expect(await errorOf(merchants.addFirstBrand(other, brand))).toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // --- Select Your Products & Redirect -----------------------------------

  describe('Select Your Products & Redirect', () => {
    const ready = async () => {
      const signedUp = await signUp();
      await register(signedUp.scope);
      await merchants.addFirstBrand(signedUp.scope, brand);
      return signedUp.scope;
    };

    it('shows the fixed list, each with its name and description, none enabled yet', async () => {
      const scope = await ready();

      const view = await products.list(scope);

      expect(view.onboardingComplete).toBe(false);
      expect(view.products.map((p) => [p.product, p.name, p.enabled, p.canEnable])).toEqual([
        ['INVOICING', 'Sugrpay', false, true],
        ['HQ', 'HQ', false, true],
      ]);
      expect(view.products.every((p) => p.description.length > 0)).toBe(true);
    });

    it('enables one product, completes onboarding, and opens it straight away', async () => {
      const scope = await ready();

      const result = await products.enable(scope, ['INVOICING']);

      expect(result.onboardingComplete).toBe(true);
      expect(result.continueWith).toBe('INVOICING');
      expect(result.products.find((p) => p.product === 'HQ')!.enabled).toBe(false);
      const role = await owner.userProductRole.findUnique({
        where: { userId_product: { userId: scope.userId, product: 'INVOICING' } },
      });
      expect(role?.role).toBe('MERCHANT_OWNER');
    });

    it('enables more than one product, and the user chooses which to open', async () => {
      const scope = await ready();

      const result = await products.enable(scope, ['INVOICING', 'HQ']);

      expect(result.products.every((p) => p.enabled)).toBe(true);
      expect(result.continueWith).toBeNull();
      const hqRole = await owner.userProductRole.findUnique({
        where: { userId_product: { userId: scope.userId, product: 'HQ' } },
      });
      expect(hqRole?.role).toBe('EXECUTIVE');
    });

    it('enables another product later, keeping the first', async () => {
      const scope = await ready();
      await products.enable(scope, ['INVOICING']);

      const result = await products.enable(scope, ['HQ']);

      expect(result.products.every((p) => p.enabled)).toBe(true);
    });

    it('is not reachable before the company is registered or before a brand is added', async () => {
      const { scope } = await signUp();
      expect(await codeOf(products.enable(scope, ['INVOICING']))).toBe('COMPANY_NOT_REGISTERED');

      await register(scope);
      expect(await codeOf(products.enable(scope, ['INVOICING']))).toBe('ADD_BRAND_FIRST');
      // The plan-and-billing toggle is held to the same steps.
      expect(await codeOf(subscriptions.update(scope, 'INVOICING', { status: 'ACTIVE' }))).toBe(
        'ADD_BRAND_FIRST',
      );

      const view = await products.list(scope);
      expect(view.onboardingComplete).toBe(false);
      expect(view.products.some((p) => p.enabled)).toBe(false);
    });

    it('lets only the Company Admin enable; other users continue into enabled products', async () => {
      const scope = await ready();
      await products.enable(scope, ['INVOICING']);
      const other = await addUser(scope);

      const view = await products.list(other);
      expect(view.products.every((p) => !p.canEnable)).toBe(true);
      expect(await errorOf(products.enable(other, ['HQ']))).toBeInstanceOf(ForbiddenException);
      await expect(products.continueInto(other, 'INVOICING')).resolves.toMatchObject({
        product: 'INVOICING',
      });
    });

    it('sends the user into an enabled product with a short-lived JWT for it', async () => {
      const scope = await ready();
      await products.enable(scope, ['INVOICING']);

      const launch = await products.continueInto(scope, 'INVOICING');

      expect(launch.url).toBe(env.ADMIN_PUBLIC_URL);
      const { payload } = await jwtVerify(launch.token, new TextEncoder().encode(JWT_SECRET), {
        issuer: 'platform',
        audience: 'INVOICING',
      });
      expect(payload.sub).toBe(scope.userId);
      expect(payload['mid']).toBe(scope.merchantId);
      expect(payload.exp! - payload.iat!).toBe(15 * 60);
      expect(typeof payload.jti).toBe('string');
    });

    it('issues no JWT for a product that is not enabled', async () => {
      const scope = await ready();
      await products.enable(scope, ['INVOICING']);

      expect(await codeOf(products.continueInto(scope, 'HQ'))).toBe('PRODUCT_NOT_ENABLED');
    });

    it('says HQ is not available yet while it has no web address', async () => {
      const scope = await ready();
      await products.enable(scope, ['HQ']);

      expect(await codeOf(products.continueInto(scope, 'HQ'))).toBe('PRODUCT_NOT_AVAILABLE');
    });
  });

  // --- Company isolation -------------------------------------------------

  it("keeps each company's data separate", async () => {
    const a = await signUp();
    await register(a.scope);
    await merchants.addFirstBrand(a.scope, brand);
    await products.enable(a.scope, ['INVOICING']);
    const b = await signUp();

    const bState = await merchants.getOnboardingState(b.scope);
    expect(bState).toMatchObject({ nextStep: 'REGISTER_COMPANY', hasBrands: false });
    expect(bState.company.companyName).toBeNull();
    expect((await products.list(b.scope)).products.some((p) => p.enabled)).toBe(false);
    expect(await codeOf(products.continueInto(b.scope, 'INVOICING'))).toBe('PRODUCT_NOT_ENABLED');
    expect(ConflictException).toBeDefined();
  });
});
