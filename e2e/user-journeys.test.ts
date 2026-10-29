/**
 * End-to-end: everything a normal user of Sugrpay can do, over real HTTP,
 * against both APIs as production builds them (configureApp) — the platform
 * API and the Sugrpay API, each its own app on its own port, talking to each
 * other over their /internal routes — on the local databases and Redis. Each
 * call goes to the API that owns its path (apiServiceFor), as the web app's
 * calls do. Mail is captured instead of sent; payments go through the
 * fake gateway. The full list of journeys, and which test covers each, is in
 * docs/testing/user-scenarios.md.
 *
 * Needs the local stack (pnpm setup:local); skipped when no database is set.
 * Every run uses fresh companies and email addresses, and its own client
 * address for the rate limits, so runs never collide.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MAIL_PORT, type MailPort, type SendMailInput } from '@platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiServiceFor } from '@platform/platform-contracts';
import { configureApp, getEnv, loadEnv, resetEnvCache } from '@platform/server';
import { AppModule as PlatformAppModule } from '../apps/platform/src/app.module.js';
import { AppModule as SugrpayAppModule } from '../apps/sugrpay/src/app.module.js';

loadEnv();
const hasDb = Boolean(process.env['PLATFORM_DATABASE_URL'] && process.env['REDIS_URL']);
const describeWithStack = hasDb ? describe : describe.skip;

/** A real 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
}

/** A free local port, so a run never collides with a dev server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

describeWithStack('user journeys (end to end)', () => {
  const run = randomBytes(3).toString('hex');
  // One client address per run: the rate limits count per address.
  const clientIp = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const outbox: SendMailInput[] = [];
  const apps: NestExpressApplication[] = [];
  const base = { platform: '', sugrpay: '' };
  let env: ReturnType<typeof getEnv>;

  async function call(
    method: string,
    path: string,
    options: {
      token?: string;
      body?: unknown;
      form?: FormData;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { 'x-forwarded-for': clientIp, ...options.headers };
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    let body: FormData | string | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const url = `${base[apiServiceFor(path)]}${path}`;
    const response = await fetch(url, { method, headers, body, redirect: 'manual' });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (a PDF, an empty 204)
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  const email = (who: string) => `${who}-${run}-${randomBytes(2).toString('hex')}@e2e-${run}.test`;
  const PASSWORD = 'correct horse battery staple';

  /** The link token from the last email sent to an address. */
  function linkTokenFor(address: string): string {
    const message = [...outbox].reverse().find((m) => m.to.includes(address));
    const token = /token=([0-9a-f]{64})/.exec(message?.text ?? '')?.[1];
    if (!token) throw new Error(`no link emailed to ${address}`);
    return token;
  }

  /** Sign Up with a company email and a password; returns the session token. */
  async function signUp(address: string): Promise<string> {
    const reply = await call('POST', '/auth/register', {
      body: { email: address, password: PASSWORD },
    });
    expect(reply.status, JSON.stringify(reply.body)).toBe(201);
    expect(reply.body.nextStep).toBe('REGISTER_COMPANY');
    return reply.body.token as string;
  }

  /** Register Your Company → Add Your Brand → Select Your Products (Sugrpay).
   * Returns the brand id. */
  async function onboard(token: string, company: string): Promise<string> {
    const registered = await call('POST', '/merchant/register-company', {
      token,
      body: {
        companyName: `${company} ${run}`,
        legalName: `${company} LLC`,
        taxId: '12-3456789',
        brandStructure: 'SINGLE',
      },
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    expect(registered.body.nextStep).toBe('ADD_BRAND');
    const added = await call('POST', '/merchant/first-brand', {
      token,
      body: {
        legalName: `${company} LLC`,
        displayName: company,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.nextStep).toBe('SELECT_PRODUCTS');
    const enabled = await call('POST', '/company/products', {
      token,
      body: { products: ['INVOICING'] },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body.continueWith).toBe('INVOICING');
    return added.body.brand.id as string;
  }

  // State shared along the journeys, in order.
  let ownerEmail = '';
  let owner = '';
  let brandId = '';
  let customerId = '';

  async function issuedInvoice(unitPrice: string): Promise<{ id: string; publicToken: string }> {
    const created = await call('POST', `/brands/${brandId}/invoices`, {
      token: owner,
      body: {
        brandId,
        customerId,
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-31',
        currency: 'USD',
        lines: [
          { itemName: 'Service', description: null, quantity: '1', unitPrice, taxExempt: true },
        ],
        taxRateBp: 0,
        cardFeeRateBp: 0,
        notes: null,
        internalNotes: null,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const issued = await call('POST', `/brands/${brandId}/invoices/${created.body.id}/issue`, {
      token: owner,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBeLessThan(300);
    return { id: issued.body.id, publicToken: issued.body.publicToken };
  }

  beforeAll(async () => {
    // Each API on its own free port, and the shared key their /internal
    // routes need — set before either app reads its configuration.
    const [platformPort, sugrpayPort] = [await freePort(), await freePort()];
    process.env['PLATFORM_INTERNAL_URL'] = `http://127.0.0.1:${platformPort}`;
    process.env['SUGRPAY_INTERNAL_URL'] = `http://127.0.0.1:${sugrpayPort}`;
    process.env['INTERNAL_API_KEY'] = randomBytes(32).toString('hex');
    process.env['PRODUCT_JWT_SECRET'] = randomBytes(32).toString('hex');
    resetEnvCache();
    env = getEnv();

    for (const [module, port, name] of [
      [PlatformAppModule, platformPort, 'platform'],
      [SugrpayAppModule, sugrpayPort, 'sugrpay'],
    ] as const) {
      const app = await NestFactory.create<NestExpressApplication>(module, {
        rawBody: true,
        logger: ['error'],
      });
      configureApp(app, env);
      // Capture mail instead of sending it (both APIs send some).
      const mail = app.get<MailPort>(MAIL_PORT);
      (mail as { send: MailPort['send'] }).send = async (input) => {
        outbox.push(input);
        return {
          providerMessageId: `e2e-${outbox.length}`,
          acceptedAt: new Date(),
          recipients: [],
        };
      };
      await app.listen(port, '127.0.0.1');
      apps.push(app);
      base[name] = `http://127.0.0.1:${port}`;
    }
  }, 60_000);

  afterAll(async () => {
    for (const app of apps.reverse()) await app.close();
  });

  // --- Sign-up and sign-in ---------------------------------------------------

  it('1. signs up with a company email and a password, and is signed in', async () => {
    ownerEmail = email('owner');
    owner = await signUp(ownerEmail);

    const me = await call('GET', '/auth/me', { token: owner });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: ownerEmail, role: 'MERCHANT_OWNER' });
  });

  it('2. refuses to sign up an address that already has an account', async () => {
    const again = await call('POST', '/auth/register', {
      body: { email: ownerEmail, password: PASSWORD },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EMAIL_TAKEN');

    const personal = await call('POST', '/auth/register', {
      body: { email: `someone-${run}@gmail.com`, password: PASSWORD },
    });
    expect(personal.status).toBe(400);
    expect(personal.body.issues[0].path).toBe('email');
  });

  it('3. signs in with the right password; the wrong one and an unknown email get the same 401', async () => {
    const ok = await call('POST', '/auth/login', {
      body: { email: ownerEmail, password: PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly/i);

    const wrong = await call('POST', '/auth/login', {
      body: { email: ownerEmail, password: 'nope-nope-nope' },
    });
    const unknown = await call('POST', '/auth/login', {
      body: { email: email('nobody'), password: 'nope-nope-nope' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  // --- Onboarding and settings -------------------------------------------------

  it('4. completes onboarding: registers the company, adds its brand, enables Sugrpay', async () => {
    const before = await call('GET', '/merchant/onboarding', { token: owner });
    expect(before.body.nextStep).toBe('REGISTER_COMPANY');
    // A step cannot be skipped over the API.
    const skip = await call('POST', '/company/products', {
      token: owner,
      body: { products: ['INVOICING'] },
    });
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('COMPANY_NOT_REGISTERED');

    brandId = await onboard(owner, 'acme');

    const state = await call('GET', '/merchant/onboarding', { token: owner });
    expect(state.body).toMatchObject({ nextStep: 'SELECT_PRODUCTS', onboardingComplete: true });
    const launch = await call('POST', '/company/products/INVOICING/continue', { token: owner });
    expect(launch.status, JSON.stringify(launch.body)).toBe(200);
    expect(launch.body.token.split('.')).toHaveLength(3);
    const notEnabled = await call('POST', '/company/products/HQ/continue', { token: owner });
    expect(notEnabled.body.code).toBe('PRODUCT_NOT_ENABLED');
  });

  it('5. turns on ACH and check payments for the brand', async () => {
    const saved = await call('PATCH', `/brands/${brandId}/settings/payment-methods`, {
      token: owner,
      body: {
        cardEnabled: false,
        applePayEnabled: false,
        googlePayEnabled: false,
        achEnabled: true,
        checkEnabled: true,
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  });

  it('6. uploads a real logo, and is refused a file pretending to be one', async () => {
    const good = new FormData();
    good.append('file', new Blob([PNG], { type: 'image/png' }), 'logo.png');
    expect(
      (await call('POST', `/brands/${brandId}/logo`, { token: owner, form: good })).status,
    ).toBeLessThan(300);

    const fake = new FormData();
    fake.append(
      'file',
      new Blob(['<html><script>alert(1)</script>'], { type: 'image/png' }),
      'logo.png',
    );
    expect(
      (await call('POST', `/brands/${brandId}/logo`, { token: owner, form: fake })).status,
    ).toBe(400);
  });

  // --- Customers and invoices --------------------------------------------------

  it('7. adds a customer, edits them, and finds them by search', async () => {
    const customer = {
      type: 'BUSINESS',
      salutation: null,
      firstName: null,
      lastName: null,
      companyName: 'Globex',
      displayName: `Globex ${run}`,
      email: email('ap'),
      phone: null,
      billingAddress: null,
      shippingAddress: null,
    };
    const created = await call('POST', `/brands/${brandId}/customers`, {
      token: owner,
      body: customer,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    customerId = created.body.id;

    const edited = await call('PATCH', `/brands/${brandId}/customers/${customerId}`, {
      token: owner,
      body: { ...customer, displayName: `Globex Corp ${run}` },
    });
    expect(edited.status).toBe(200);

    const found = await call(
      'GET',
      `/brands/${brandId}/customers?search=${encodeURIComponent(`Globex Corp ${run}`)}`,
      {
        token: owner,
      },
    );
    expect(found.body.data.map((c: { id: string }) => c.id)).toEqual([customerId]);
  });

  it('8. creates and sends an invoice; the customer opens the link and pays by ACH', async () => {
    const { id, publicToken } = await issuedInvoice('120.40');

    const view = await call('GET', `/public/invoices/${publicToken}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ balanceMinor: 12040 });

    const paid = await call('POST', `/public/invoices/${publicToken}/payment-intents`, {
      body: { method: 'ACH', attemptNonce: randomUUID() },
    });
    expect(paid.status, JSON.stringify(paid.body)).toBeLessThan(300);
    expect(paid.body.invoiceStatus).toBe('PAID');

    const row = await call('GET', `/brands/${brandId}/invoices/${id}`, { token: owner });
    expect(row.body).toMatchObject({ status: 'PAID', balanceMinor: 0 });
    const payments = await call('GET', `/brands/${brandId}/payments`, { token: owner });
    expect(payments.status).toBe(200);
  });

  it('9. records a partial payment by hand; the customer is then charged only the rest', async () => {
    const { id, publicToken } = await issuedInvoice('100.40');
    const partial = await call('POST', `/brands/${brandId}/invoices/${id}/payments`, {
      token: owner,
      body: { amount: '40.00', method: 'MANUAL', paidAt: new Date().toISOString() },
    });
    expect(partial.status, JSON.stringify(partial.body)).toBeLessThan(300);
    expect(partial.body.status).toBe('PARTIALLY_PAID');

    const paid = await call('POST', `/public/invoices/${publicToken}/payment-intents`, {
      body: { method: 'ACH', attemptNonce: randomUUID() },
    });
    expect(paid.body.invoiceStatus).toBe('PAID');
    const payments = await call('GET', `/brands/${brandId}/payments?search=`, { token: owner });
    const ach = payments.body.data.find(
      (p: { invoiceId: string; method: string }) => p.invoiceId === id && p.method === 'ACH',
    );
    expect(ach.amountMinor).toBe(6040);
  });

  it('10. a customer mails a check; staff approve it for the amount written on it', async () => {
    const { id, publicToken } = await issuedInvoice('300.00');
    const form = new FormData();
    form.append('checkNumber', '1042');
    form.append('front', new Blob([PNG], { type: 'image/png' }), 'front.png');
    form.append('back', new Blob([PNG], { type: 'image/png' }), 'back.png');
    const upload = await call('POST', `/public/invoices/${publicToken}/checks`, { form });
    expect(upload.status, JSON.stringify(upload.body)).toBeLessThan(300);

    const disguised = new FormData();
    disguised.append('checkNumber', '1043');
    disguised.append('front', new Blob(['not an image'], { type: 'image/png' }), 'front.png');
    disguised.append('back', new Blob([PNG], { type: 'image/png' }), 'back.png');
    expect(
      (await call('POST', `/public/invoices/${publicToken}/checks`, { form: disguised })).status,
    ).toBe(400);

    const queue = await call('GET', `/brands/${brandId}/checks?status=PENDING`, { token: owner });
    const check = queue.body.data.find((c: { checkNumber: string }) => c.checkNumber === '1042');
    const approved = await call('POST', `/brands/${brandId}/checks/${check.id}/approve`, {
      token: owner,
      body: { amount: '100.00' },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);

    const row = await call('GET', `/brands/${brandId}/invoices/${id}`, { token: owner });
    expect(row.body).toMatchObject({ status: 'PARTIALLY_PAID', balanceMinor: 20000 });
  });

  it('11. cancels an invoice; its link no longer takes payment', async () => {
    const { id, publicToken } = await issuedInvoice('75.00');
    const cancelled = await call('POST', `/brands/${brandId}/invoices/${id}/cancel`, {
      token: owner,
    });
    expect(cancelled.status).toBeLessThan(300);

    const attempt = await call('POST', `/public/invoices/${publicToken}/payment-intents`, {
      body: { method: 'ACH', attemptNonce: randomUUID() },
    });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
  });

  it('12. a customer cannot start a "manual" payment from the payment page', async () => {
    const { publicToken } = await issuedInvoice('20.00');
    const attempt = await call('POST', `/public/invoices/${publicToken}/payment-intents`, {
      body: { method: 'MANUAL', attemptNonce: randomUUID() },
    });
    expect(attempt.status).toBe(400);
  });

  it('13. sees the dashboard and the invoice list', async () => {
    expect((await call('GET', `/dashboard/summary`, { token: owner })).status).toBe(200);
    const list = await call('GET', `/brands/${brandId}/invoices`, { token: owner });
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(5);
  });

  // --- The team ----------------------------------------------------------------

  let financeEmail = '';
  let financeId = '';
  let finance = '';
  let financeInviteToken = '';

  it('14. invites a finance teammate, who joins through the emailed link', async () => {
    financeEmail = email('finance');
    const invited = await call('POST', '/users/invite', {
      token: owner,
      body: { name: 'Fin Ance', email: financeEmail, role: 'FINANCE_USER', brandIds: [brandId] },
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    financeId = invited.body.id;
    financeInviteToken = linkTokenFor(financeEmail);

    const joined = await call('POST', '/auth/set-password/token', {
      body: { token: financeInviteToken, newPassword: PASSWORD },
    });
    expect(joined.status).toBe(200);
    finance = joined.body.token;
  });

  it('15. the finance teammate works on invoices but cannot manage the team or settings', async () => {
    expect((await call('GET', `/brands/${brandId}/invoices`, { token: finance })).status).toBe(200);
    const invite = await call('POST', '/users/invite', {
      token: finance,
      body: { name: 'X', email: email('x'), role: 'READ_ONLY', brandIds: [brandId] },
    });
    expect(invite.status).toBe(403);
    const settings = await call('PATCH', `/brands/${brandId}/settings/payment-methods`, {
      token: finance,
      body: {
        cardEnabled: true,
        applePayEnabled: false,
        googlePayEnabled: false,
        achEnabled: true,
        checkEnabled: true,
      },
    });
    expect(settings.status).toBe(403);
  });

  it('16. suspending the teammate ends their session and keeps them out', async () => {
    const forgot = await call('POST', '/auth/forgot-password', { body: { email: financeEmail } });
    expect(forgot.status).toBe(202);
    const resetToken = linkTokenFor(financeEmail);

    const suspended = await call('PATCH', `/users/${financeId}/status`, {
      token: owner,
      body: { status: 'SUSPENDED' },
    });
    expect(suspended.status).toBe(200);

    expect((await call('GET', '/auth/me', { token: finance })).status).toBe(401);
    const login = await call('POST', '/auth/login', {
      body: { email: financeEmail, password: PASSWORD },
    });
    expect(login.status).toBe(401);
    // A reset link requested before the suspension is no way back in.
    const reuse = await call('POST', '/auth/set-password/token', {
      body: { token: resetToken, newPassword: 'another long password' },
    });
    expect(reuse.status).toBe(401);
  });

  // --- Passwords and sessions --------------------------------------------------

  it('17. forgets the password, resets it from the email; old sessions end', async () => {
    const before = await call('POST', '/auth/login', {
      body: { email: ownerEmail, password: PASSWORD },
    });
    const oldSession = before.body.token as string;

    expect(
      (await call('POST', '/auth/forgot-password', { body: { email: ownerEmail } })).status,
    ).toBe(202);
    const reset = await call('POST', '/auth/set-password/token', {
      body: { token: linkTokenFor(ownerEmail), newPassword: 'a brand new long password' },
    });
    expect(reset.status).toBe(200);
    owner = reset.body.token;

    expect((await call('GET', '/auth/me', { token: oldSession })).status).toBe(401);
    expect(
      (await call('POST', '/auth/login', { body: { email: ownerEmail, password: PASSWORD } }))
        .status,
    ).toBe(401);
    expect(
      (
        await call('POST', '/auth/login', {
          body: { email: ownerEmail, password: 'a brand new long password' },
        })
      ).status,
    ).toBe(200);
  });

  it('18. changing the password needs the current one, and signs out other sessions', async () => {
    const other = (
      await call('POST', '/auth/login', {
        body: { email: ownerEmail, password: 'a brand new long password' },
      })
    ).body.token as string;

    const without = await call('POST', '/auth/set-password', {
      token: owner,
      body: { newPassword: 'yet another long password' },
    });
    expect(without.status).toBe(401);

    const changed = await call('POST', '/auth/set-password', {
      token: owner,
      body: {
        newPassword: 'yet another long password',
        currentPassword: 'a brand new long password',
      },
    });
    expect(changed.status).toBe(200);
    expect((await call('GET', '/auth/me', { token: owner })).status).toBe(200);
    expect((await call('GET', '/auth/me', { token: other })).status).toBe(401);
  });

  it('19. signs out; the session no longer works', async () => {
    const session = (
      await call('POST', '/auth/login', {
        body: { email: ownerEmail, password: 'yet another long password' },
      })
    ).body.token as string;
    expect((await call('POST', '/auth/logout', { token: session })).status).toBe(204);
    expect((await call('GET', '/auth/me', { token: session })).status).toBe(401);
  });

  // --- Boundaries between companies, and the anonymous ------------------------

  it("20. another company's owner cannot see or touch this company's brand", async () => {
    const rival = await signUp(email('rival'));
    await onboard(rival, 'rival');

    for (const [method, path] of [
      ['GET', `/brands/${brandId}/invoices`],
      ['GET', `/brands/${brandId}/customers/${customerId}`],
      ['GET', `/brands/${brandId}/integrations/stripe/connect`],
      ['POST', `/brands/${brandId}/integrations/zoho/pull`],
      ['PATCH', `/brands/${brandId}/settings/payment-methods`],
    ] as const) {
      const reply = await call(method, path, {
        token: rival,
        body:
          method === 'PATCH'
            ? {
                cardEnabled: true,
                applePayEnabled: false,
                googlePayEnabled: false,
                achEnabled: true,
                checkEnabled: true,
              }
            : undefined,
      });
      expect([403, 404], `${method} ${path}`).toContain(reply.status);
    }
  });

  it('21. without a session every private route answers 401', async () => {
    for (const path of [
      '/auth/me',
      '/brands',
      `/brands/${brandId}/invoices`,
      '/users',
      '/dashboard/summary',
    ]) {
      expect((await call('GET', path)).status, path).toBe(401);
    }
    expect((await call('GET', '/auth/me', { token: 'f'.repeat(64) })).status).toBe(401);
  });

  it('22. the customer downloads the invoice as a PDF from the link', async () => {
    const { publicToken } = await issuedInvoice('42.00');
    const pdf = await call('GET', `/public/invoices/${publicToken}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toMatch(/application\/pdf/);
  }, 60_000);

  it('23. an unknown or malformed payment link reveals nothing', async () => {
    expect((await call('GET', `/public/invoices/${'0'.repeat(32)}`)).status).toBe(404);
    // A link of the wrong shape is refused before any lookup.
    expect([400, 404]).toContain((await call('GET', '/public/invoices/not-a-token')).status);
  });

  it('24. only the web app may call the API from a browser; every response carries the security headers', async () => {
    const allowed = new URL(env.ADMIN_PUBLIC_URL).origin;
    const fromApp = await call('GET', '/health/live', { headers: { origin: allowed } });
    expect(fromApp.headers.get('access-control-allow-origin')).toBe(allowed);
    const fromElsewhere = await call('GET', '/health/live', {
      headers: { origin: 'https://evil.example' },
    });
    expect(fromElsewhere.headers.get('access-control-allow-origin')).toBeNull();

    expect(fromApp.headers.get('x-powered-by')).toBeNull();
    expect(fromApp.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fromApp.headers.get('x-frame-options')).toBe('DENY');
  });

  it('25. guessing passwords for one account is cut off with 429', async () => {
    const target = email('target');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await call('POST', '/auth/login', {
            body: { email: target, password: 'guess-guess-guess' },
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
