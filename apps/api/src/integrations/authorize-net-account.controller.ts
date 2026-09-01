import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  authorizeNetConnectSchema,
  idSchema,
  IntegrationError,
  type AuthorizeNetConnectInput,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import { AuthorizeNetAccountService, type AuthorizeNetStatus } from './authorize-net-account.service.js';

/**
 * Authorize.net, per brand. Unlike Stripe/Square there is no redirect
 * handshake — connect is a plain authenticated POST carrying the brand's own
 * API Login ID and Transaction Key, verified against Authorize.net before
 * ever being stored (see AuthorizeNetAccountService).
 */
@Controller('brands/:brandId/integrations/authorize-net')
export class AuthorizeNetAccountController {
  constructor(private readonly authorizeNet: AuthorizeNetAccountService) {}

  @Get('status')
  @RequirePermission('INTEGRATIONS', 'READ')
  getStatus(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<AuthorizeNetStatus> {
    return this.authorizeNet.getStatus(scope, brandId);
  }

  @Post('connect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async connect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(authorizeNetConnectSchema)) body: AuthorizeNetConnectInput,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    try {
      await this.authorizeNet.connect(scope, brandId, body);
    } catch (cause) {
      throw this.mapIntegrationError(cause);
    }
    return { ok: true };
  }

  @Post('disconnect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async disconnect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.authorizeNet.disconnect(scope, brandId);
    return { ok: true };
  }

  /** A provider refusal (bad credentials, unreachable) is the request failing
   * against a live service, not this API misbehaving — 400/502, not a bare
   * 500. Same convention as StripeAccountController. */
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
