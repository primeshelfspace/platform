/**
 * ZohoBooksAdapter over real HTTP.
 *
 * Every other Zoho test in this repo subclasses the adapter and overrides the
 * methods that touch the network, which means the transport itself has never
 * been exercised: request()'s URL building and organization_id injection, the
 * OAuth grants, the per-brand rate limiter, the error classification the
 * worker's retry policy depends on, and — the reason this file exists —
 * resolveWriteVersion, which decides whether echo suppression can engage at
 * all.
 *
 * A local HTTP server standing in for Zoho Books v3 covers all of that without
 * needing a real Zoho account. It is not a substitute for testing against the
 * live API (Zoho's actual response shapes remain an assumption), but it does
 * verify every line of our own transport, which was previously untested.
 *
 * Needs Redis for the rate limiter: pnpm setup:local
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationError, type AccountingConnection } from '@fenwick/shared';
import { loadEnv } from '../../config/load-env.js';
import { getEnv, type Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { ZohoBooksAdapter } from './zoho-books.adapter.js';

loadEnv();
const hasRedis = Boolean(process.env['REDIS_URL']);
const describeWithRedis = hasRedis ? describe : describe.skip;

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  auth: string | undefined;
}

/** Programmable stand-in for Zoho Books v3, over real HTTP. */
class FakeZohoServer {
  readonly requests: Recorded[] = [];
  private server: Server | undefined;
  private routes = new Map<
    string,
    () => { status: number; body: unknown; headers?: Record<string, string> }
  >();

  /** `${METHOD} ${pathname}` -> response. */
  on(
    key: string,
    responder: () => { status: number; body: unknown; headers?: Record<string, string> },
  ): void {
    this.routes.set(key, responder);
  }

  get origin(): string {
    const address = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const raw = Buffer.concat(chunks).toString('utf8');
        this.requests.push({
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          body: raw === '' ? undefined : JSON.parse(raw),
          auth: req.headers.authorization,
        });

        const responder = this.routes.get(`${req.method} ${url.pathname}`);
        if (!responder) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ code: 1000, message: `no stub for ${req.method} ${url.pathname}` }),
          );
          return;
        }
        const { status, body, headers } = responder();
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.clear();
  }
}

describeWithRedis('ZohoBooksAdapter over HTTP', () => {
  const realEnv = getEnv();
  const zohoServer = new FakeZohoServer();
  let redis: RedisService;
  let adapter: ZohoBooksAdapter;
  let connection: AccountingConnection;

  beforeAll(async () => {
    await zohoServer.start();
    redis = new RedisService(realEnv);
    const env = {
      ...realEnv,
      ZOHO_API_DOMAIN: zohoServer.origin,
      ZOHO_ACCOUNTS_DOMAIN: zohoServer.origin,
      ZOHO_CLIENT_ID: 'test-client-id',
      ZOHO_CLIENT_SECRET: 'test-client-secret',
      ZOHO_REDIRECT_URI: 'http://localhost/integrations/zoho/callback',
    } as Env;
    adapter = new ZohoBooksAdapter(env, redis);
  });

  afterAll(async () => {
    await Promise.all([zohoServer.stop(), redis.onModuleDestroy()]);
  });

  beforeEach(() => {
    zohoServer.reset();
    // A fresh brand id per test so the rate limiter's own per-brand window
    // never leaks between cases.
    connection = {
      brandId: `http-test-${Math.random().toString(36).slice(2)}`,
      organisationId: 'org-999',
      accessToken: 'access-token-abc',
      refreshToken: 'refresh-token-xyz',
      expiresAt: null,
    };
  });

  const INVOICE_PAYLOAD = {
    localId: 'local-1',
    remoteId: null,
    number: 'INV-0001',
    customerRemoteId: 'contact-1',
    currency: 'USD' as const,
    invoiceDate: new Date('2026-08-01'),
    dueDate: new Date('2026-08-31'),
    lines: [
      {
        name: 'Consulting',
        description: null,
        quantity: 10_000,
        unitPriceMinor: 10000,
        lineTotalMinor: 10000,
        taxExempt: false,
        remoteTaxId: null,
      },
    ],
    subtotalMinor: 10000,
    taxRateBpApplied: 800,
    taxMinor: 800,
    cardFeeMinor: 300,
    totalMinor: 11100,
    notes: null,
    status: 'SENT' as const,
  };

  // --- transport ------------------------------------------------------------

  it('signs the request and injects organization_id', async () => {
    zohoServer.on('GET /books/v3/organizations', () => ({
      status: 200,
      body: { organizations: [{ organization_id: 'org-999', name: 'Acme Books' }] },
    }));
    const orgs = await adapter.listOrganizations('access-token-abc', zohoServer.origin);
    expect(orgs).toEqual([{ organizationId: 'org-999', name: 'Acme Books' }]);
    expect(zohoServer.requests[0]!.auth).toBe('Zoho-oauthtoken access-token-abc');
  });

  it('exchanges a refresh token and reports the real expiry', async () => {
    zohoServer.on('POST /oauth/v2/token', () => ({
      status: 200,
      body: { access_token: 'fresh-token', expires_in: 3600 },
    }));
    const before = Date.now();
    const { accessToken, expiresAt } = await adapter.refreshAccessToken('refresh-token-xyz');
    expect(accessToken).toBe('fresh-token');
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_599_000);

    const sent = zohoServer.requests[0]!;
    expect(sent.query.get('grant_type')).toBe('refresh_token');
    expect(sent.query.get('client_secret')).toBe('test-client-secret');
  });

  // --- resolveWriteVersion: the reason this file exists ---------------------

  it('captures the write version from the response, with no extra request', async () => {
    zohoServer.on('POST /books/v3/invoices', () => ({
      status: 200,
      body: {
        invoice: { invoice_id: 'zoho-inv-1', last_modified_time: '2026-08-20T10:00:00+0000' },
      },
    }));

    const ref = await adapter.pushInvoice(connection, INVOICE_PAYLOAD);
    expect(ref.remoteId).toBe('zoho-inv-1');
    expect(ref.updatedAt?.toISOString()).toBe('2026-08-20T10:00:00.000Z');
    // One call only — the readback must not fire when the write already told us.
    expect(zohoServer.requests).toHaveLength(1);
  });

  it('reads the write version back when the write response omits it', async () => {
    // The fallback that keeps echo suppression armed. Without it a Zoho that
    // does not echo last_modified_time on writes would leave every pushed
    // invoice with a null version, silently disabling the check and letting the
    // round-trip corruption return.
    zohoServer.on('POST /books/v3/invoices', () => ({
      status: 200,
      body: { invoice: { invoice_id: 'zoho-inv-2' } },
    }));
    zohoServer.on('GET /books/v3/invoices/zoho-inv-2', () => ({
      status: 200,
      body: {
        invoice: {
          invoice_id: 'zoho-inv-2',
          customer_id: 'contact-1',
          invoice_number: 'INV-0001',
          status: 'sent',
          date: '2026-08-01',
          due_date: '2026-08-31',
          currency_code: 'USD',
          total: 111,
          balance: 111,
          sub_total: 111,
          tax_total: 0,
          line_items: [],
          last_modified_time: '2026-08-20T11:30:00+0000',
        },
      },
    }));

    const ref = await adapter.pushInvoice(connection, INVOICE_PAYLOAD);
    expect(ref.updatedAt?.toISOString()).toBe('2026-08-20T11:30:00.000Z');
    expect(zohoServer.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /books/v3/invoices',
      'GET /books/v3/invoices/zoho-inv-2',
    ]);
  });

  it('survives a failed readback rather than failing the whole push', async () => {
    // A null version means the next pull treats the record as changed — the old
    // behaviour. Losing the optimisation is acceptable; losing the push is not.
    zohoServer.on('POST /books/v3/invoices', () => ({
      status: 200,
      body: { invoice: { invoice_id: 'zoho-inv-3' } },
    }));
    zohoServer.on('GET /books/v3/invoices/zoho-inv-3', () => ({
      status: 500,
      body: { code: 9000, message: 'internal error' },
    }));

    const ref = await adapter.pushInvoice(connection, INVOICE_PAYLOAD);
    expect(ref.remoteId).toBe('zoho-inv-3');
    expect(ref.updatedAt).toBeNull();
  });

  it('uses PUT and the same version capture when the invoice already exists', async () => {
    zohoServer.on('PUT /books/v3/invoices/existing-9', () => ({
      status: 200,
      body: {
        invoice: { invoice_id: 'existing-9', last_modified_time: '2026-08-21T09:00:00+0000' },
      },
    }));
    const ref = await adapter.pushInvoice(connection, {
      ...INVOICE_PAYLOAD,
      remoteId: 'existing-9',
    });
    expect(ref.updatedAt?.toISOString()).toBe('2026-08-21T09:00:00.000Z');
    expect(zohoServer.requests[0]!.method).toBe('PUT');
  });

  it('pushes tax and the card fee as their own line items', async () => {
    // Documents the asymmetry echo suppression exists to contain: what Zoho
    // ends up holding is not the shape we sent it conceptually.
    zohoServer.on('POST /books/v3/invoices', () => ({
      status: 200,
      body: { invoice: { invoice_id: 'x', last_modified_time: '2026-08-20T10:00:00+0000' } },
    }));
    await adapter.pushInvoice(connection, INVOICE_PAYLOAD);

    const body = zohoServer.requests[0]!.body as {
      line_items: Array<{ name: string; rate: number }>;
    };
    expect(body.line_items.map((l) => l.name)).toEqual([
      'Consulting',
      'Tax',
      'Card processing fee',
    ]);
    expect(body.line_items.map((l) => l.rate)).toEqual([100, 8, 3]);
  });

  it('concatenates line1/line2 into one street address and never sends country', async () => {
    // FR-ZHO-webhook address rules: Zoho's contact address is one street
    // value, and country is platform-only — never pushed.
    zohoServer.on('POST /books/v3/contacts', () => ({
      status: 200,
      body: {
        contact: { contact_id: 'contact-1', last_modified_time: '2026-08-20T10:00:00+0000' },
      },
    }));
    await adapter.upsertCustomer(connection, {
      localId: 'local-1',
      remoteId: null,
      type: 'BUSINESS',
      displayName: 'Acme Co',
      companyName: null,
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      billingAddress: {
        line1: '1 Harbour Street',
        line2: 'Suite 4',
        city: 'Boston',
        region: 'MA',
        postalCode: '02110',
        country: 'US',
      },
      shippingAddress: null,
      currency: 'USD',
    });

    const body = zohoServer.requests[0]!.body as {
      billing_address: Record<string, unknown>;
    };
    expect(body.billing_address['address']).toBe('1 Harbour Street\nSuite 4');
    expect(body.billing_address['street2']).toBeUndefined();
    expect(body.billing_address['country']).toBeUndefined();
  });

  // --- error classification -------------------------------------------------

  it('classifies a 429 as transient and carries Retry-After through', async () => {
    zohoServer.on('GET /books/v3/organizations', () => ({
      status: 429,
      body: { code: 1001, message: 'too many requests' },
      headers: { 'retry-after': '30' },
    }));
    const error = await adapter
      .listOrganizations('t', zohoServer.origin)
      .catch((e: unknown) => e as IntegrationError);

    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).errorClass).toBe('TRANSIENT');
    expect((error as IntegrationError).retryAfterMs).toBe(30_000);
    expect((error as IntegrationError).providerMessage).toBe('too many requests');
  });

  it('classifies a 401 as authentication, which is not retryable', async () => {
    zohoServer.on('GET /books/v3/organizations', () => ({
      status: 401,
      body: { code: 57, message: 'invalid oauth token' },
    }));
    const error = (await adapter
      .listOrganizations('t', zohoServer.origin)
      .catch((e: unknown) => e)) as IntegrationError;

    expect(error.errorClass).toBe('AUTHENTICATION');
    expect(error.retryable).toBe(false);
  });

  it("treats the OAuth endpoint's 400 Access Denied as a rate limit, not a validation error", async () => {
    // Zoho signals a token-refresh rate limit as a plain 400, which the default
    // classifier reads as permanently invalid — the specific override the
    // adapter carries for it.
    zohoServer.on('POST /oauth/v2/token', () => ({
      status: 400,
      body: { error: 'Access Denied' },
    }));
    const error = (await adapter
      .refreshAccessToken('refresh-token-xyz')
      .catch((e: unknown) => e)) as IntegrationError;

    expect(error.errorClass).toBe('TRANSIENT');
    expect(error.retryable).toBe(true);
  });

  it('surfaces a provider message verbatim rather than paraphrasing it', async () => {
    zohoServer.on('GET /books/v3/organizations', () => ({
      status: 400,
      body: { code: 4001, message: 'Invalid value passed for organization_id' },
    }));
    const error = (await adapter
      .listOrganizations('t', zohoServer.origin)
      .catch((e: unknown) => e)) as IntegrationError;

    expect(error.providerMessage).toBe('Invalid value passed for organization_id');
    expect(error.providerCode).toBe('4001');
  });

  // --- rate limiter ---------------------------------------------------------

  it('paces requests against the per-brand budget instead of only reacting to 429s', async () => {
    zohoServer.on('GET /books/v3/contacts', () => ({
      status: 200,
      body: { contacts: [], page_context: { has_more_page: false } },
    }));

    // 90 is the adapter's own ceiling, deliberately under Zoho's documented
    // 100. Draining it should let every call through; the 91st is what the
    // limiter has to hold back, which is asserted by the token count rather
    // than by waiting out the real 65-second timeout.
    for (let i = 0; i < 90; i++) {
      await adapter.listContactsPage(connection, 1);
    }
    expect(zohoServer.requests).toHaveLength(90);
    expect(await redis.acquireRateToken(connection.brandId, 90, 60)).toBe(false);
  });
});
