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
import { StripeAccountService, type StripeAccountStatus } from './stripe-account.service.js';

/**
 * Stripe Connect, per brand. The brand admin authorises the platform on
 * Stripe's own consent screen; nothing here ever accepts an API key.
 *
 * Shaped deliberately like ZohoConnectController — same signed-state
 * handshake, same reason the callback is @Public (the provider's redirect
 * arrives as a fresh browser request carrying no session).
 */
@Controller()
export class StripeAccountController {
  constructor(
    private readonly stripeAccounts: StripeAccountService,
    private readonly systemScope: SystemScopeResolver,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('brands/:brandId/integrations/stripe/status')
  @RequirePermission('INTEGRATIONS', 'READ')
  getStatus(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<StripeAccountStatus> {
    return this.stripeAccounts.getStatus(scope, brandId);
  }

  /** Redirects to Stripe's consent screen. A GET that redirects, so the admin
   * UI can be a plain link rather than a fetch the browser cannot follow
   * cross-origin. */
  @Get('brands/:brandId/integrations/stripe/connect')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  connect(@Param('brandId', zodPipe(idSchema)) brandId: string, @Res() response: Response): void {
    try {
      response.redirect(this.stripeAccounts.buildAuthorizeUrl(brandId));
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
  }

  /**
   * Stripe's redirect back. Public because it arrives with no session cookie —
   * the signed `state` is what proves which brand began the flow, and the
   * system scope is minted from that rather than from a caller who cannot be
   * authenticated here.
   */
  @Get('integrations/stripe/callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // The Stripe panel lives on the Payment Gateways tab of
    // /settings/integrations — there is no standalone /settings/stripe page.
    const settingsUrl = `${this.env.ADMIN_PUBLIC_URL}/settings/integrations`;
    const tab = 'tab=payments';

    if (error) {
      response.redirect(`${settingsUrl}?${tab}&stripeError=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('missing code or state');
    }

    const verified = this.stripeAccounts.verifyCallbackState(state);
    if (!verified) {
      response.redirect(`${settingsUrl}?${tab}&stripeError=invalid_or_expired_state`);
      return;
    }
    const { brandId } = verified;

    const scope = await this.systemScope.forBrand(brandId, 'stripe-oauth-callback');
    if (!scope) {
      response.redirect(`${settingsUrl}?${tab}&stripeError=unknown_brand`);
      return;
    }

    try {
      await this.stripeAccounts.completeConnection(scope, brandId, code);
    } catch (cause) {
      const message = cause instanceof IntegrationError ? cause.message : 'connection_failed';
      response.redirect(
        `${settingsUrl}?${tab}&brandId=${brandId}&stripeError=${encodeURIComponent(message)}`,
      );
      return;
    }

    response.redirect(`${settingsUrl}?${tab}&brandId=${brandId}&stripeConnected=1`);
  }

  @Post('brands/:brandId/integrations/stripe/disconnect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async disconnect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    try {
      await this.stripeAccounts.disconnect(scope, brandId);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
    return { ok: true };
  }

  /** A provider refusal is the request failing against a live service, not this
   * API misbehaving — 400/502, not a bare 500. */
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
