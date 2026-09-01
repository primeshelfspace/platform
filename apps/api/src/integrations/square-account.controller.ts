import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IntegrationError, idSchema, type Scope } from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { ENV, type Env } from '../config/env.js';
import { CurrentScope, Public, RequirePermission } from '../tenancy/authorisation.js';
import { SystemScopeResolver } from '../tenancy/system-scope.js';
import { SquareAccountService, type SquareAccountStatus } from './square-account.service.js';

/**
 * Square Connect, per brand. Shaped identically to StripeAccountController —
 * same signed-state handshake, same reason the callback is @Public (Square's
 * redirect arrives as a fresh browser request carrying no session).
 */
@Controller()
export class SquareAccountController {
  constructor(
    private readonly squareAccounts: SquareAccountService,
    private readonly systemScope: SystemScopeResolver,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('brands/:brandId/integrations/square/status')
  @RequirePermission('INTEGRATIONS', 'READ')
  getStatus(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<SquareAccountStatus> {
    return this.squareAccounts.getStatus(scope, brandId);
  }

  /** Redirects to Square's consent screen. A GET that redirects, so the admin
   * UI can be a plain link rather than a fetch the browser cannot follow
   * cross-origin. */
  @Get('brands/:brandId/integrations/square/connect')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  connect(@Param('brandId', zodPipe(idSchema)) brandId: string, @Res() response: Response): void {
    try {
      response.redirect(this.squareAccounts.buildAuthorizeUrl(brandId));
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  /**
   * Square's redirect back. Public because it arrives with no session
   * cookie — the signed `state` is what proves which brand began the flow.
   */
  @Get('integrations/square/callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // The Square panel lives on the Payment Gateways tab of /brand-settings,
    // same as Stripe's.
    const settingsUrl = `${this.env.ADMIN_PUBLIC_URL}/brand-settings`;
    const tab = 'tab=payments';

    if (error) {
      response.redirect(`${settingsUrl}?${tab}&squareError=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('missing code or state');
    }

    const verified = this.squareAccounts.verifyCallbackState(state);
    if (!verified) {
      response.redirect(`${settingsUrl}?${tab}&squareError=invalid_or_expired_state`);
      return;
    }
    const { brandId } = verified;

    const scope = await this.systemScope.forBrand(brandId, 'square-oauth-callback');
    if (!scope) {
      response.redirect(`${settingsUrl}?${tab}&squareError=unknown_brand`);
      return;
    }

    try {
      await this.squareAccounts.completeConnection(scope, brandId, code);
    } catch (cause) {
      const message = cause instanceof IntegrationError ? cause.message : 'connection_failed';
      response.redirect(
        `${settingsUrl}?${tab}&brandId=${brandId}&squareError=${encodeURIComponent(message)}`,
      );
      return;
    }

    response.redirect(`${settingsUrl}?${tab}&brandId=${brandId}&squareConnected=1`);
  }

  @Post('brands/:brandId/integrations/square/disconnect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async disconnect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    try {
      await this.squareAccounts.disconnect(scope, brandId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
    return { ok: true };
  }

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
