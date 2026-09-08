import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IntegrationError,
  idSchema,
  zohoSandboxActivationSchema,
  zohoSandboxChangeReviewSchema,
  zohoSandboxChangesScopeSchema,
  zohoSandboxCreateSchema,
  zohoSandboxPushConfirmSchema,
  zohoSandboxUpdateSchema,
  type Scope,
  type ZohoSandboxActivationInput,
  type ZohoSandboxChangeReviewInput,
  type ZohoSandboxChangesScopeInput,
  type ZohoSandboxCreateInput,
  type ZohoSandboxUpdateInput,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  ZohoSandboxService,
  type ZohoSandbox,
  type ZohoSandboxChange,
} from './zoho-sandbox.service.js';

/**
 * Zoho Books Sandbox management (config-testing on the brand's already
 * connected org — see ZohoSandboxService's own doc comment for what this
 * actually is). Every route here is authenticated and brand-scoped like the
 * rest of Brand Settings; none of these are Zoho redirect targets, so unlike
 * ZohoConnectController's OAuth callback there is no @Public route here.
 *
 * Permission-wise this rides the same INTEGRATIONS matrix cell that already
 * gates connect/disconnect/settings (Brand Admin and above) — sandbox
 * management is exactly that kind of administrative action, not a new tier
 * of privilege the app needs to grow for this one feature.
 */
@Controller('brands/:brandId/integrations/zoho/sandboxes')
export class ZohoSandboxController {
  constructor(private readonly sandboxes: ZohoSandboxService) {}

  @Get()
  @RequirePermission('INTEGRATIONS', 'READ')
  async list(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox[]> {
    try {
      return await this.sandboxes.listSandboxes(scope, brandId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Post()
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async create(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(zohoSandboxCreateSchema)) body: ZohoSandboxCreateInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    try {
      return await this.sandboxes.createSandbox(scope, brandId, body);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Get(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'READ')
  async get(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    try {
      return await this.sandboxes.getSandbox(scope, brandId, sandboxId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Patch(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async update(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxUpdateSchema)) body: ZohoSandboxUpdateInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    try {
      return await this.sandboxes.updateSandbox(scope, brandId, sandboxId, body);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Delete(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'DELETE')
  async delete(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    try {
      await this.sandboxes.deleteSandbox(scope, brandId, sandboxId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
    return { ok: true };
  }

  @Patch(':sandboxId/activation')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async setActive(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxActivationSchema)) body: ZohoSandboxActivationInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    try {
      return await this.sandboxes.setSandboxActive(scope, brandId, sandboxId, body.active);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Post(':sandboxId/rebuild')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async rebuild(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    try {
      return await this.sandboxes.rebuildSandbox(scope, brandId, sandboxId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Get(':sandboxId/changes')
  @RequirePermission('INTEGRATIONS', 'READ')
  async changes(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Query(zodPipe(zohoSandboxChangesScopeSchema)) query: ZohoSandboxChangesScopeInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandboxChange[]> {
    try {
      return await this.sandboxes.listChanges(scope, brandId, sandboxId, query.target);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Patch(':sandboxId/changes/:changeId')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async reviewChange(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('changeId') changeId: string,
    @Body(zodPipe(zohoSandboxChangeReviewSchema)) body: ZohoSandboxChangeReviewInput,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    try {
      await this.sandboxes.markChangeReviewed(scope, brandId, changeId, body.reviewed);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
    return { ok: true };
  }

  @Post(':sandboxId/push/validate')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async validatePush(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    try {
      return await this.sandboxes.validatePush(scope, brandId, sandboxId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  /**
   * The only route in this controller that can change the brand's real,
   * production Zoho org. zohoSandboxPushConfirmSchema requires the literal
   * `confirm: true` in the body — there is no way to reach
   * ZohoSandboxService.pushToProduction from here without it, and nothing
   * else in the app (no cron, no queue worker) calls it at all.
   */
  @Post(':sandboxId/push')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async push(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxPushConfirmSchema)) _body: { confirm: true },
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    try {
      return await this.sandboxes.pushToProduction(scope, brandId, sandboxId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  @Get('logs/deployments')
  @RequirePermission('INTEGRATIONS', 'READ')
  async deploymentLogs(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    try {
      return await this.sandboxes.listDeploymentLogs(scope, brandId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  /** A provider refusal (e.g. Sandbox not enabled for this Zoho org) is the
   * request failing against a live service, not this API misbehaving —
   * 400/502 with Zoho's own message, not a bare 500. Same shape as
   * StripeAccountController's own copy of this. */
  private mapIntegrationError(cause: unknown): Error {
    if (cause instanceof IntegrationError) {
      if (cause.errorClass === 'TRANSIENT') {
        return new BadGatewayException(cause.providerMessage ?? cause.message);
      }
      return new BadRequestException(cause.providerMessage ?? cause.message);
    }
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}
