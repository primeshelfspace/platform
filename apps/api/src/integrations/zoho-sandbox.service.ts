import { Injectable, NotFoundException } from '@nestjs/common';
import type { Scope } from '@fenwick/shared';
import { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import { IntegrationConnectionService } from './integration-connection.service.js';

/**
 * ZohoSandboxService.
 *
 * Zoho Books' Sandbox API (confirmed against
 * https://www.zoho.com/books/api/v3/sandbox/) is not a parallel test
 * environment with its own credentials — it manages a sandbox *copy* of the
 * brand's already-connected production org, for safely testing configuration
 * changes (custom functions, workflows, fields) before pushing them back to
 * that same org. It therefore reuses the brand's existing OAuth connection
 * (organisationId + auto-refreshed access token from
 * IntegrationConnectionService) and the adapter's existing request()
 * transport — auth header, per-brand rate limiting and Zoho error
 * classification are not reimplemented here.
 *
 * Zoho marks this API as an early-access capability: it may not appear at
 * all for a given account/edition until enabled on Zoho's side (see
 * docs/zoho-books-sandbox.md). A brand without access gets Zoho's own error
 * surfaced through IntegrationError, same as any other Books API failure.
 *
 * Endpoint paths below are exactly as documented; none are guessed:
 *   POST   /books/v3/sandboxes
 *   GET    /books/v3/sandboxes
 *   GET    /books/v3/sandboxes/{sandbox_id}
 *   PUT    /books/v3/sandboxes/{sandbox_id}
 *   DELETE /books/v3/sandboxes/{sandbox_id}
 *   PUT    /books/v3/sandboxes/{sandbox_id}/status
 *   PUT    /books/v3/sandboxes/{sandbox_id}/rebuild
 *   GET    /books/v3/sandboxes/changes            (sandbox-org changes)
 *   GET    /books/v3/sandboxes/{sandbox_id}/changes (production-org changes)
 *   PUT    /books/v3/sandboxes/changes/markasreviewed
 *   PUT    /books/v3/sandboxes/changes/markasunreviewed
 *   POST   /books/v3/sandboxes/{sandbox_id}/changes/validatepush
 *   POST   /books/v3/sandboxes/{sandbox_id}/changes/push
 *   GET    /books/v3/sandboxes/logs
 */

interface RawZohoSandbox {
  sandbox_id: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface ZohoSandbox {
  readonly sandboxId: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

/** Field names confirmed against the Sandbox API's "list changes" example.
 * created_by/last_modified_by/dependent_components are Zoho-internal detail
 * this app has no use for, so they are deliberately not carried through. */
interface RawZohoSandboxChange {
  change_id: string;
  component_id: string;
  component_name: string;
  component_description?: string;
  action: string;
  deployment_status: string;
  module: string;
  created_time_formatted?: string;
  last_modified_time_formatted?: string;
}

export interface ZohoSandboxChange {
  readonly changeId: string;
  readonly componentId: string;
  readonly componentName: string;
  readonly action: string;
  readonly deploymentStatus: string;
  readonly module: string;
  readonly createdAt: string | null;
  readonly lastModifiedAt: string | null;
}

function toSandbox(raw: RawZohoSandbox): ZohoSandbox {
  return {
    sandboxId: raw.sandbox_id,
    name: raw.name,
    description: raw.description ?? null,
    active: raw.active,
  };
}

function toChange(raw: RawZohoSandboxChange): ZohoSandboxChange {
  return {
    changeId: raw.change_id,
    componentId: raw.component_id,
    componentName: raw.component_name,
    action: raw.action,
    deploymentStatus: raw.deployment_status,
    module: raw.module,
    createdAt: raw.created_time_formatted ?? null,
    lastModifiedAt: raw.last_modified_time_formatted ?? null,
  };
}

@Injectable()
export class ZohoSandboxService {
  constructor(
    private readonly zoho: ZohoBooksAdapter,
    private readonly connections: IntegrationConnectionService,
  ) {}

  private async requireConnection(scope: Scope, brandId: string) {
    const connection = await this.connections.buildAccountingConnection(scope, brandId);
    if (!connection) {
      throw new NotFoundException('this brand is not connected to Zoho Books');
    }
    return connection;
  }

  async listSandboxes(scope: Scope, brandId: string): Promise<ZohoSandbox[]> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandboxes?: RawZohoSandbox[] }>(
      connection,
      'GET',
      '/books/v3/sandboxes',
    );
    return (body.sandboxes ?? []).map(toSandbox);
  }

  async createSandbox(
    scope: Scope,
    brandId: string,
    input: { name?: string },
  ): Promise<ZohoSandbox> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandbox: RawZohoSandbox }>(
      connection,
      'POST',
      '/books/v3/sandboxes',
      { body: { name: input.name } },
    );
    return toSandbox(body.sandbox);
  }

  async getSandbox(scope: Scope, brandId: string, sandboxId: string): Promise<ZohoSandbox> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandbox: RawZohoSandbox }>(
      connection,
      'GET',
      `/books/v3/sandboxes/${sandboxId}`,
    );
    return toSandbox(body.sandbox);
  }

  async updateSandbox(
    scope: Scope,
    brandId: string,
    sandboxId: string,
    patch: { name?: string },
  ): Promise<ZohoSandbox> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandbox: RawZohoSandbox }>(
      connection,
      'PUT',
      `/books/v3/sandboxes/${sandboxId}`,
      { body: patch },
    );
    return toSandbox(body.sandbox);
  }

  async deleteSandbox(scope: Scope, brandId: string, sandboxId: string): Promise<void> {
    const connection = await this.requireConnection(scope, brandId);
    await this.zoho.request<unknown>(connection, 'DELETE', `/books/v3/sandboxes/${sandboxId}`);
  }

  async setSandboxActive(
    scope: Scope,
    brandId: string,
    sandboxId: string,
    active: boolean,
  ): Promise<ZohoSandbox> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandbox: RawZohoSandbox }>(
      connection,
      'PUT',
      `/books/v3/sandboxes/${sandboxId}/status`,
      { body: { active } },
    );
    return toSandbox(body.sandbox);
  }

  async rebuildSandbox(scope: Scope, brandId: string, sandboxId: string): Promise<ZohoSandbox> {
    const connection = await this.requireConnection(scope, brandId);
    const body = await this.zoho.request<{ sandbox: RawZohoSandbox }>(
      connection,
      'PUT',
      `/books/v3/sandboxes/${sandboxId}/rebuild`,
    );
    return toSandbox(body.sandbox);
  }

  /** target 'sandbox' lists changes made in the sandbox org itself; 'production'
   * lists what has changed in the production org since it was branched — the
   * two documented "list changes" endpoints, distinguished only by whether
   * sandboxId appears in the path (matches the docs exactly, not a
   * simplification on this app's part). */
  async listChanges(
    scope: Scope,
    brandId: string,
    sandboxId: string,
    target: 'sandbox' | 'production',
  ): Promise<ZohoSandboxChange[]> {
    const connection = await this.requireConnection(scope, brandId);
    const path =
      target === 'production'
        ? `/books/v3/sandboxes/${sandboxId}/changes`
        : '/books/v3/sandboxes/changes';
    const body = await this.zoho.request<{ changes?: RawZohoSandboxChange[] }>(
      connection,
      'GET',
      path,
    );
    return (body.changes ?? []).map(toChange);
  }

  async markChangeReviewed(
    scope: Scope,
    brandId: string,
    changeId: string,
    reviewed: boolean,
  ): Promise<void> {
    const connection = await this.requireConnection(scope, brandId);
    const path = reviewed
      ? '/books/v3/sandboxes/changes/markasreviewed'
      : '/books/v3/sandboxes/changes/markasunreviewed';
    await this.zoho.request<unknown>(connection, 'PUT', path, {
      body: { change_id: changeId },
    });
  }

  /** Read-only — reports what pushing would do without doing it. Always safe
   * to call from a "Validate" button ahead of the real push. */
  async validatePush(scope: Scope, brandId: string, sandboxId: string): Promise<unknown> {
    const connection = await this.requireConnection(scope, brandId);
    return this.zoho.request<unknown>(
      connection,
      'POST',
      `/books/v3/sandboxes/${sandboxId}/changes/validatepush`,
    );
  }

  /**
   * The one genuine production mutation in this whole service. Only ever
   * called from ZohoSandboxController's push endpoint, which itself refuses
   * to call this without an explicit `{ confirm: true }` in the request body
   * (zohoSandboxPushConfirmSchema) — nothing in this codebase (no cron, no
   * queue worker, no other service) calls this on its own.
   */
  async pushToProduction(scope: Scope, brandId: string, sandboxId: string): Promise<unknown> {
    const connection = await this.requireConnection(scope, brandId);
    return this.zoho.request<unknown>(
      connection,
      'POST',
      `/books/v3/sandboxes/${sandboxId}/changes/push`,
    );
  }

  /** Zoho's docs did not show a field-level example for this response, unlike
   * changes/sandboxes above — passed through raw rather than mapped onto
   * invented field names. */
  async listDeploymentLogs(scope: Scope, brandId: string): Promise<unknown> {
    const connection = await this.requireConnection(scope, brandId);
    return this.zoho.request<unknown>(connection, 'GET', '/books/v3/sandboxes/logs');
  }
}
