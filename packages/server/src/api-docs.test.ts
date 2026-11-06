/**
 * The Swagger page (/docs): the document it serves is the generated one, with
 * "Try it out" pointed at the right address for where the API runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from './config/env.js';
import { servedDocument } from './api-docs.js';

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
