import { describe, expect, it, vi } from 'vitest';
import { IntegrationError, type AccountingConnection, type Scope } from '@fenwick/shared';
import type { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import type { IntegrationConnectionService } from './integration-connection.service.js';
import { ZohoSandboxService } from './zoho-sandbox.service.js';

const SCOPE = {} as Scope;
const BRAND_ID = '11111111-1111-1111-1111-111111111111';
const CONNECTION: AccountingConnection = {
  brandId: BRAND_ID,
  organisationId: 'org-1',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() + 3600_000),
};

function makeService(
  overrides: {
    request?: ReturnType<typeof vi.fn>;
    buildAccountingConnection?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const zoho = {
    request: overrides.request ?? vi.fn(),
  } as unknown as ZohoBooksAdapter;

  const connections = {
    buildAccountingConnection:
      overrides.buildAccountingConnection ?? vi.fn().mockResolvedValue(CONNECTION),
  } as unknown as IntegrationConnectionService;

  return { service: new ZohoSandboxService(zoho, connections), zoho, connections };
}

describe('ZohoSandboxService', () => {
  it('throws NotFoundException when the brand has no Zoho connection', async () => {
    const { service } = makeService({
      buildAccountingConnection: vi.fn().mockResolvedValue(null),
    });

    await expect(service.listSandboxes(SCOPE, BRAND_ID)).rejects.toThrow(
      'this brand is not connected to Zoho Books',
    );
  });

  it('lists sandboxes, mapping raw snake_case fields onto camelCase', async () => {
    const request = vi.fn().mockResolvedValue({
      sandboxes: [{ sandbox_id: 'sb-1', name: 'Test', description: 'd', active: true }],
    });
    const { service } = makeService({ request });

    const result = await service.listSandboxes(SCOPE, BRAND_ID);

    expect(request).toHaveBeenCalledWith(CONNECTION, 'GET', '/books/v3/sandboxes');
    expect(result).toEqual([{ sandboxId: 'sb-1', name: 'Test', description: 'd', active: true }]);
  });

  it('creates a sandbox with the given name', async () => {
    const request = vi.fn().mockResolvedValue({
      sandbox: { sandbox_id: 'sb-2', name: 'New', active: false },
    });
    const { service } = makeService({ request });

    const result = await service.createSandbox(SCOPE, BRAND_ID, { name: 'New' });

    expect(request).toHaveBeenCalledWith(CONNECTION, 'POST', '/books/v3/sandboxes', {
      body: { name: 'New' },
    });
    expect(result).toEqual({ sandboxId: 'sb-2', name: 'New', description: null, active: false });
  });

  it('activates and deactivates a sandbox via the status endpoint', async () => {
    const request = vi.fn().mockResolvedValue({
      sandbox: { sandbox_id: 'sb-1', name: 'Test', active: true },
    });
    const { service } = makeService({ request });

    await service.setSandboxActive(SCOPE, BRAND_ID, 'sb-1', true);

    expect(request).toHaveBeenCalledWith(CONNECTION, 'PUT', '/books/v3/sandboxes/sb-1/status', {
      body: { active: true },
    });
  });

  it('lists sandbox-org changes without a sandbox id in the path', async () => {
    const request = vi.fn().mockResolvedValue({ changes: [] });
    const { service } = makeService({ request });

    await service.listChanges(SCOPE, BRAND_ID, 'sb-1', 'sandbox');

    expect(request).toHaveBeenCalledWith(CONNECTION, 'GET', '/books/v3/sandboxes/changes');
  });

  it('lists production-org changes scoped to the sandbox id', async () => {
    const request = vi.fn().mockResolvedValue({ changes: [] });
    const { service } = makeService({ request });

    await service.listChanges(SCOPE, BRAND_ID, 'sb-1', 'production');

    expect(request).toHaveBeenCalledWith(CONNECTION, 'GET', '/books/v3/sandboxes/sb-1/changes');
  });

  it('maps a change list response onto camelCase fields', async () => {
    const request = vi.fn().mockResolvedValue({
      changes: [
        {
          change_id: 'c-1',
          component_id: 'comp-1',
          component_name: 'Invoice Template',
          action: 'updated',
          deployment_status: 'pending',
          module: 'Invoice',
          created_time_formatted: '2024-01-01T00:00:00Z',
          last_modified_time_formatted: '2024-01-02T00:00:00Z',
        },
      ],
    });
    const { service } = makeService({ request });

    const result = await service.listChanges(SCOPE, BRAND_ID, 'sb-1', 'production');

    expect(result).toEqual([
      {
        changeId: 'c-1',
        componentId: 'comp-1',
        componentName: 'Invoice Template',
        action: 'updated',
        deploymentStatus: 'pending',
        module: 'Invoice',
        createdAt: '2024-01-01T00:00:00Z',
        lastModifiedAt: '2024-01-02T00:00:00Z',
      },
    ]);
  });

  it('pushes to production only against the given sandbox id, with no confirmation logic of its own', async () => {
    // Confirmation is enforced one layer up, by ZohoSandboxController requiring
    // { confirm: true } (zohoSandboxPushConfirmSchema) before this is ever
    // called — this test just pins down which endpoint actually gets hit.
    const request = vi.fn().mockResolvedValue({ status: 'ok' });
    const { service } = makeService({ request });

    await service.pushToProduction(SCOPE, BRAND_ID, 'sb-1');

    expect(request).toHaveBeenCalledWith(
      CONNECTION,
      'POST',
      '/books/v3/sandboxes/sb-1/changes/push',
    );
  });

  it('propagates a Zoho IntegrationError untouched (e.g. a scope/permission failure)', async () => {
    const error = new IntegrationError({
      message: 'Zoho Books: GET /books/v3/sandboxes failed with 403',
      errorClass: 'AUTHENTICATION',
      provider: 'zoho-books',
      providerMessage: 'You do not have sufficient scope to access this resource',
      httpStatus: 403,
    });
    const request = vi.fn().mockRejectedValue(error);
    const { service } = makeService({ request });

    await expect(service.listSandboxes(SCOPE, BRAND_ID)).rejects.toBe(error);
  });

  it('marks a change reviewed and unreviewed via the two distinct endpoints', async () => {
    const request = vi.fn().mockResolvedValue({});
    const { service } = makeService({ request });

    await service.markChangeReviewed(SCOPE, BRAND_ID, 'c-1', true);
    expect(request).toHaveBeenCalledWith(
      CONNECTION,
      'PUT',
      '/books/v3/sandboxes/changes/markasreviewed',
      { body: { change_id: 'c-1' } },
    );

    await service.markChangeReviewed(SCOPE, BRAND_ID, 'c-1', false);
    expect(request).toHaveBeenCalledWith(
      CONNECTION,
      'PUT',
      '/books/v3/sandboxes/changes/markasunreviewed',
      { body: { change_id: 'c-1' } },
    );
  });
});
