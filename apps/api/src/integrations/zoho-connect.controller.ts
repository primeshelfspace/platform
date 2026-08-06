import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  IntegrationError,
  idSchema,
  zohoSyncSettingsSchema,
  type Scope,
  type ZohoSyncSettingsInput,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { ENV, type Env } from '../config/env.js';
import { ZohoBooksAdapter } from '../adapters/accounting/zoho-books.adapter.js';
import { QueueService } from '../infra/queue/queue.service.js';
import { CurrentScope, Public, RequirePermission } from '../tenancy/authorisation.js';
import { SystemScopeResolver } from '../tenancy/system-scope.js';
import {
  IntegrationConnectionService,
  type ZohoActivityEntry,
  type ZohoConnectionStatus,
} from './integration-connection.service.js';
import { signOAuthState, verifyOAuthState } from './oauth-state.js';
import { ZohoSyncService, type BackfillCounts } from './zoho-sync.service.js';

/**
 * FR-ZHO-001. The connect leg is authenticated and brand-scoped as normal;
 * the callback leg cannot be — Zoho's redirect is a fresh, unauthenticated
 * browser request — so it derives the brand from the signed state instead
 * (TDD-001 §12, same pattern as the public payment path: possession of a
 * signed token is the credential, not a session).
 */
@Controller()
export class ZohoConnectController {
  private readonly logger = new Logger(ZohoConnectController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly zoho: ZohoBooksAdapter,
    private readonly connections: IntegrationConnectionService,
    private readonly systemScope: SystemScopeResolver,
    private readonly sync: ZohoSyncService,
    private readonly queue: QueueService,
  ) {}

  @Get('brands/:brandId/integrations/zoho/status')
  @RequirePermission('INTEGRATIONS', 'READ')
  status(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoConnectionStatus> {
    return this.connections.getStatus(scope, brandId);
  }

  @Get('brands/:brandId/integrations/zoho/activity')
  @RequirePermission('INTEGRATIONS', 'READ')
  activity(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoActivityEntry[]> {
    return this.connections.getRecentActivity(scope, brandId);
  }

  /**
   * FR-ZHO-013. Re-runnable on demand — enqueueBackfill only ever queues
   * records still missing a zoho*Id, so calling this again after the initial
   * connect (or after fixing a failed sync) is always safe.
   */
  @Post('brands/:brandId/integrations/zoho/backfill')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async backfill(@Param('brandId', zodPipe(idSchema)) brandId: string): Promise<BackfillCounts> {
    try {
      return await this.sync.enqueueBackfill(brandId);
    } catch (cause) {
      // Surface what Zoho actually said (e.g. a rate limit) rather than a
      // bare 500 — this is exactly the failure mode that showed up as an
      // unhelpful "Internal server error" in the admin UI.
      if (cause instanceof IntegrationError) {
        throw new BadGatewayException(cause.providerMessage ?? cause.message);
      }
      throw cause;
    }
  }

  /**
   * FR-ZHO-030. Enqueues rather than pulling inline — a full pull can
   * paginate through hundreds of records across three entity types plus a
   * detail fetch per record, which comfortably exceeds a sane HTTP timeout
   * for a large account. This also runs automatically at the brand's own
   * configured frequency (worker.ts's 'scheduled-sync' handler); this
   * endpoint just lets it be triggered on demand instead of waiting.
   */
  @Post('brands/:brandId/integrations/zoho/pull')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async pullNow(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<{ queued: boolean }> {
    await this.queue.enqueue('sync', 'zoho-pull-brand', { brandId });
    return { queued: true };
  }

  /**
   * FR-ZHO-030's settings panel. NotFoundException from the service surfaces
   * as 404 here rather than a silent no-op — configuring a connection that
   * does not exist is a real error, not a valid empty state.
   */
  @Patch('brands/:brandId/integrations/zoho/settings')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  updateSettings(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(zohoSyncSettingsSchema)) body: ZohoSyncSettingsInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoConnectionStatus> {
    return this.connections.updateSyncSettings(scope, brandId, body);
  }

  @Post('brands/:brandId/integrations/zoho/disconnect')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async disconnect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.connections.disconnectZoho(scope, brandId);
    return { ok: true };
  }

  @Get('brands/:brandId/integrations/zoho/connect')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  connect(@Param('brandId', zodPipe(idSchema)) brandId: string, @Res() response: Response): void {
    const state = signOAuthState(brandId, 'zoho', this.env.SESSION_SECRET);
    const url = new URL('/oauth/v2/auth', this.env.ZOHO_ACCOUNTS_DOMAIN);
    url.searchParams.set('client_id', this.env.ZOHO_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', this.env.ZOHO_REDIRECT_URI ?? '');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'ZohoBooks.fullaccess.all');
    url.searchParams.set('access_type', 'offline'); // without this, no refresh_token comes back
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    response.redirect(url.toString());
  }

  @Get('integrations/zoho/callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const adminUrl = this.env.ADMIN_PUBLIC_URL;

    if (error) {
      response.redirect(`${adminUrl}/settings/integrations?error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('missing code or state');
    }

    const verified = verifyOAuthState(state, 'zoho', this.env.SESSION_SECRET);
    if (!verified) {
      response.redirect(`${adminUrl}/settings/integrations?error=invalid_or_expired_state`);
      return;
    }
    const { brandId } = verified;

    try {
      const tokens = await this.zoho.exchangeAuthorizationCode(code);
      const organizations = await this.zoho.listOrganizations(tokens.accessToken, tokens.apiDomain);

      if (organizations.length === 0) {
        response.redirect(
          `${adminUrl}/settings/integrations?brandId=${brandId}&error=no_organizations`,
        );
        return;
      }
      // More than one organization on the authorizing account picks the
      // first rather than prompting — a real "choose your organization"
      // step is a UI addition, not a correctness gap, but is not built here.
      const organization = organizations[0]!;

      const scope = await this.systemScope.forBrand(brandId, 'zoho-oauth-callback');
      if (!scope) {
        response.redirect(`${adminUrl}/settings/integrations?error=unknown_brand`);
        return;
      }

      await this.connections.saveZohoConnection(
        scope,
        brandId,
        { refreshToken: tokens.refreshToken, apiDomain: tokens.apiDomain },
        { organizationId: organization.organizationId, organizationName: organization.name },
      );

      // Everything that existed before this connection is worth pushing too,
      // not just what happens from here on (FR-ZHO-013). Enqueuing is fast —
      // awaited so a failure here can still redirect with connected=1 rather
      // than silently losing it, but it must never block on the jobs
      // actually running.
      try {
        await this.sync.enqueueBackfill(brandId);
      } catch (backfillError) {
        this.logger.warn(
          `initial backfill enqueue failed for brand ${brandId}: ${backfillError instanceof Error ? backfillError.message : backfillError}`,
        );
      }

      response.redirect(`${adminUrl}/settings/integrations?brandId=${brandId}&connected=1`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      response.redirect(
        `${adminUrl}/settings/integrations?brandId=${brandId}&error=${encodeURIComponent(message)}`,
      );
    }
  }
}
