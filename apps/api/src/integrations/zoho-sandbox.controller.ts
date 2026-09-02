import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
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
  list(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox[]> {
    return this.sandboxes.listSandboxes(scope, brandId);
  }

  @Post()
  @RequirePermission('INTEGRATIONS', 'WRITE')
  create(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(zohoSandboxCreateSchema)) body: ZohoSandboxCreateInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    return this.sandboxes.createSandbox(scope, brandId, body);
  }

  @Get(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'READ')
  get(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    return this.sandboxes.getSandbox(scope, brandId, sandboxId);
  }

  @Patch(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  update(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxUpdateSchema)) body: ZohoSandboxUpdateInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    return this.sandboxes.updateSandbox(scope, brandId, sandboxId, body);
  }

  @Delete(':sandboxId')
  @RequirePermission('INTEGRATIONS', 'DELETE')
  async delete(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.sandboxes.deleteSandbox(scope, brandId, sandboxId);
    return { ok: true };
  }

  @Patch(':sandboxId/activation')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  setActive(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxActivationSchema)) body: ZohoSandboxActivationInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    return this.sandboxes.setSandboxActive(scope, brandId, sandboxId, body.active);
  }

  @Post(':sandboxId/rebuild')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  rebuild(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandbox> {
    return this.sandboxes.rebuildSandbox(scope, brandId, sandboxId);
  }

  @Get(':sandboxId/changes')
  @RequirePermission('INTEGRATIONS', 'READ')
  changes(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Query(zodPipe(zohoSandboxChangesScopeSchema)) query: ZohoSandboxChangesScopeInput,
    @CurrentScope() scope: Scope,
  ): Promise<ZohoSandboxChange[]> {
    return this.sandboxes.listChanges(scope, brandId, sandboxId, query.target);
  }

  @Patch(':sandboxId/changes/:changeId')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async reviewChange(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('changeId') changeId: string,
    @Body(zodPipe(zohoSandboxChangeReviewSchema)) body: ZohoSandboxChangeReviewInput,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.sandboxes.markChangeReviewed(scope, brandId, changeId, body.reviewed);
    return { ok: true };
  }

  @Post(':sandboxId/push/validate')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  validatePush(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    return this.sandboxes.validatePush(scope, brandId, sandboxId);
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
  push(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('sandboxId') sandboxId: string,
    @Body(zodPipe(zohoSandboxPushConfirmSchema)) _body: { confirm: true },
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    return this.sandboxes.pushToProduction(scope, brandId, sandboxId);
  }

  @Get('logs/deployments')
  @RequirePermission('INTEGRATIONS', 'READ')
  deploymentLogs(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<unknown> {
    return this.sandboxes.listDeploymentLogs(scope, brandId);
  }
}
