/**
 * The Swagger page (/docs): the document it serves is the generated one, with
 * "Try it out" pointed at the right address for where the API runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from './config/env.js';
import { mountApiDocs, servedDocument } from './api-docs.js';

const document = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../docs/api/openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, { operationId: string }>> };

const env = (overrides: Partial<Env>): Env =>
  ({
    APP_ENV: 'local',
    API_PUBLIC_URL: 'http://localhost:4001',
    PLATFORM_API_PORT: 4001,
    SUGRPAY_API_PORT: 4002,
    ...overrides,
  }) as Env;

type Served = {
  servers: { url: string }[];
  paths: Record<string, { servers?: { url: string }[] }>;
};

describe('servedDocument', () => {
  it('sends every request to the front door in a deployed environment', () => {
    const served = servedDocument(
      document,
      env({ APP_ENV: 'production', API_PUBLIC_URL: 'https://api.sugrpay.com' }),
    ) as Served;
    expect(served.servers.map((s) => s.url)).toEqual(['https://api.sugrpay.com']);
    expect(Object.values(served.paths).some((item) => item.servers)).toBe(false);
  });

  it('locally, sends each path to the API that owns it', () => {
    const served = servedDocument(document, env({})) as Served;
    expect(served.servers.map((s) => s.url)).toEqual(['http://localhost:4001']);
    expect(served.paths['/auth/login']?.servers).toBeUndefined();
    expect(served.paths['/brands/{brandId}/invoices']?.servers?.[0]?.url).toBe(
      'http://localhost:4002',
    );
    expect(served.paths['/public/invoices/{token}']?.servers?.[0]?.url).toBe(
      'http://localhost:4002',
    );
  });

  it('documents every route once, each with its own operation id', () => {
    const ids = Object.values(document.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- The HQ page (/hq/docs) -------------------------------------------------

type Op = {
  tags: string[];
  description: string;
  security: Record<string, string[]>[];
  requestBody?: { content: Record<string, { example?: unknown }> };
  responses: Record<
    string,
    { content?: Record<string, { example?: unknown; examples?: Record<string, unknown> }> }
  >;
};
const hq = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../docs/api/hq-openapi.json'), 'utf8'),
) as {
  info: { title: string; description: string };
  tags: { name: string }[];
  paths: Record<string, Record<string, Op>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
};
const hqOps = Object.entries(hq.paths).flatMap(([p, item]) =>
  Object.entries(item).map(([method, op]) => ({ key: `${method.toUpperCase()} ${p}`, op })),
);

describe('the HQ document', () => {
  it('lists the APIs HQ uses, grouped in story order', () => {
    expect(hq.info.title).toBe('HQ API');
    expect(hq.tags.map((t) => t.name)).toEqual([
      '1. Accounts: sign up and onboarding',
      '2. Product Session',
      '3. Company Profile',
      '4. Brand Management',
      '5. User Management',
      '6. Role List',
      '7. Service',
    ]);
    expect(hqOps.map((o) => o.key)).toEqual(
      expect.arrayContaining([
        'GET /product-session/me',
        'POST /product-session/refresh',
        'GET /companies/{companyId}',
        'POST /company/brands',
        'PUT /company/brands/{brandId}',
        'POST /company/brands/{brandId}/archive',
        'GET /company/users',
        'POST /company/users',
        'PUT /company/users/{userId}',
        'POST /company/users/{userId}/deactivate',
        'POST /company/users/{userId}/reactivate',
        'GET /company/roles',
        'POST /company/products/{product}/continue',
      ]),
    );
    expect(hqOps.every(({ op }) => hq.tags.some((t) => t.name === op.tags[0]))).toBe(true);
  });

  it('leaves out everything HQ does not use', () => {
    const paths = Object.keys(hq.paths);
    expect(paths.some((p) => p.startsWith('/internal'))).toBe(false);
    expect(paths.some((p) => p.includes('/invoices') || p.includes('/customers'))).toBe(false);
  });

  it('gives every API a guide, a success example and its errors', () => {
    for (const { key, op } of hqOps) {
      expect(op.description, key).toMatch(/\*\*Authorization:\*\*/);
      const success = Object.entries(op.responses).find(([status]) => status.startsWith('2'));
      expect(success, key).toBeDefined();
      const media = success![1].content?.['application/json'];
      if (media) expect(media.example, `${key} success example`).toBeDefined();
      if (op.requestBody) {
        expect(op.requestBody.content['application/json']?.example, `${key} request`).toBeDefined();
      }
    }
    const refresh = hq.paths['/product-session/refresh']!['post']!;
    expect(Object.keys(refresh.responses['401']!.content!['application/json']!.examples!)).toEqual([
      'SIGN_IN_REQUIRED',
      'INVALID_REFRESH_TOKEN',
    ]);
  });

  it('asks for the HQ JWT on the HQ APIs and the Accounts token on onboarding', () => {
    expect(Object.keys(hq.components.securitySchemes).sort()).toEqual([
      'accountsSession',
      'productJwt',
    ]);
    expect(hq.paths['/company/roles']!['get']!.security).toEqual([{ productJwt: [] }]);
    expect(hq.paths['/merchant/onboarding']!['get']!.security).toEqual([{ accountsSession: [] }]);
    expect(hq.paths['/product-session/refresh']!['post']!.security).toEqual([]);
  });

  it('carries every schema it refers to', () => {
    const refs = [...JSON.stringify(hq.paths).matchAll(/#\/components\/schemas\/(\w+)/g)].map(
      (m) => m[1]!,
    );
    for (const name of refs) expect(hq.components.schemas[name], name).toBeDefined();
  });
});

describe('mountApiDocs', () => {
  /** Records the routes mounted, and answers them like Express would. */
  const mount = (overrides: Partial<Env> = {}) => {
    const routes = new Map<string, (req: unknown, res: unknown) => void>();
    const http = {
      get: (paths: string | string[], handler: (req: unknown, res: unknown) => void) => {
        for (const p of ([] as string[]).concat(paths)) routes.set(p, handler);
      },
    };
    mountApiDocs(http as never, env({ API_DOCS_ENABLED: true, ...overrides }));
    const get = (p: string) => {
      const reply = { type: '', body: '' };
      const res = {
        type: (t: string) => {
          reply.type = t;
          return res;
        },
        send: (body: string) => {
          reply.body = body;
          return res;
        },
      };
      routes.get(p)!({ params: {} }, res);
      return reply;
    };
    return { routes, get };
  };

  it('serves the HQ page at /hq/docs, beside /docs', () => {
    const { routes, get } = mount();
    for (const p of [
      '/docs',
      '/docs/init.js',
      '/docs/openapi.json',
      '/hq/docs',
      '/hq/docs/',
      '/hq/docs/init.js',
      '/hq/docs/openapi.json',
    ]) {
      expect(routes.has(p), p).toBe(true);
    }
    expect(get('/hq/docs').body).toContain('<title>HQ API</title>');
    expect(get('/hq/docs').body).toContain('src="/hq/docs/init.js"');
    expect(get('/hq/docs/init.js').body).toContain("url: '/hq/docs/openapi.json'");
    expect(get('/hq/docs/init.js').body).not.toContain('tagsSorter');
    expect(get('/docs/init.js').body).toContain("tagsSorter: 'alpha'");
    const served = JSON.parse(get('/hq/docs/openapi.json').body) as { info: { title: string } };
    expect(served.info.title).toBe('HQ API');
  });

  it('points "Try it out" at the front door in production', () => {
    const { get } = mount({ APP_ENV: 'production', API_PUBLIC_URL: 'https://api.sugrpay.com' });
    const served = JSON.parse(get('/hq/docs/openapi.json').body) as Served;
    expect(served.servers.map((s) => s.url)).toEqual(['https://api.sugrpay.com']);
  });

  it('serves nothing when the docs are switched off', () => {
    const { routes } = mount({ API_DOCS_ENABLED: false });
    expect(routes.size).toBe(0);
  });
});
