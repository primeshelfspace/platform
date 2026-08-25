/**
 * ZohoConnectController had no existing test coverage. This file covers only
 * the one behaviour this feature added to `callback()`: a successful OAuth
 * exchange must enqueue a pull (bringing Zoho's existing contacts in) in
 * addition to the pre-existing push backfill — not instead of it. Everything
 * else on the controller (the connect() redirect builder, error branches) is
 * unchanged by this feature and left untested here.
 *
 * Hand-mocked dependencies, matching the style already used in
 * zoho-pull.service.test.ts and zoho-books.adapter.test.ts rather than a full
 * Nest TestingModule — the controller takes plain constructor params, so
 * there is nothing a DI container would add here.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { Env } from '../config/env.js';
import type { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import type { IntegrationConnectionService } from './integration-connection.service.js';
import type { SystemScopeResolver } from '../tenancy/system-scope.js';
import type { ZohoSyncService } from './zoho-sync.service.js';
import type { QueueService } from '../infra/queue/queue.service.js';
import { ZohoConnectController } from './zoho-connect.controller.js';
import { signOAuthState } from './oauth-state.js';

const SESSION_SECRET = 'test-session-secret';
const BRAND_ID = '11111111-1111-1111-1111-111111111111';

function makeResponse() {
  return { redirect: vi.fn() } as unknown as Response;
}

function makeController(overrides: { queueEnqueue?: ReturnType<typeof vi.fn> } = {}) {
  const env = {
    SESSION_SECRET,
    ADMIN_PUBLIC_URL: 'http://localhost:3000',
    ZOHO_CLIENT_ID: 'client-id',
    ZOHO_REDIRECT_URI: 'http://localhost:4000/integrations/zoho/callback',
    ZOHO_ACCOUNTS_DOMAIN: 'https://accounts.zoho.com',
  } as unknown as Env;

  const zoho = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      apiDomain: 'https://www.zohoapis.com',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    listOrganizations: vi.fn().mockResolvedValue([{ organizationId: 'org-1', name: 'Test Org' }]),
  } as unknown as ZohoBooksAdapter;

  const connections = {
    saveZohoConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as IntegrationConnectionService;

  const systemScope = {
    forBrand: vi.fn().mockResolvedValue({ merchantId: 'merchant-1' }),
  } as unknown as SystemScopeResolver;

  const sync = {
    enqueueBackfill: vi.fn().mockResolvedValue(undefined),
  } as unknown as ZohoSyncService;

  const queue = {
    enqueue: overrides.queueEnqueue ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as QueueService;

  const controller = new ZohoConnectController(env, zoho, connections, systemScope, sync, queue);
  return { controller, zoho, connections, systemScope, sync, queue };
}

describe('ZohoConnectController.callback', () => {
  it('enqueues both the push backfill and a pull, on a successful connect', async () => {
    const { controller, sync, queue } = makeController();
    const state = signOAuthState(BRAND_ID, 'zoho', SESSION_SECRET);
    const response = makeResponse();

    await controller.callback('auth-code', state, undefined, response);

    expect(sync.enqueueBackfill).toHaveBeenCalledWith(BRAND_ID);
    expect(queue.enqueue).toHaveBeenCalledWith('sync', 'zoho-pull-brand', { brandId: BRAND_ID });
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining(`brandId=${BRAND_ID}&connected=1`),
    );
  });

  it('still redirects successfully even if enqueuing the pull fails', async () => {
    const queueEnqueue = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const { controller } = makeController({ queueEnqueue });
    const state = signOAuthState(BRAND_ID, 'zoho', SESSION_SECRET);
    const response = makeResponse();

    await controller.callback('auth-code', state, undefined, response);

    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining(`brandId=${BRAND_ID}&connected=1`),
    );
  });
});
