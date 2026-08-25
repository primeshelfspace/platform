import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  idSchema,
  paymentGatewayProviderSchema,
  type PaymentGatewayProvider,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import { PaymentGatewaysService, type PaymentGatewaySummary } from './payment-gateways.service.js';

/**
 * Brand Settings → Payment Gateways' list/detail screen (see
 * PaymentGatewaysService for what "connected" actually means per provider).
 * Nested separately from StripeAccountController — Stripe keeps its own
 * `/integrations/stripe/*` routes for the real OAuth handshake; this is only
 * the read model across all four gateways plus connect/disconnect for the
 * three that have no handshake of their own.
 */
@Controller('brands/:brandId/integrations/gateways')
export class PaymentGatewaysController {
  constructor(private readonly gateways: PaymentGatewaysService) {}

  @Get()
  @RequirePermission('INTEGRATIONS', 'READ')
  list(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @CurrentScope() scope: Scope,
  ): Promise<PaymentGatewaySummary[]> {
    return this.gateways.list(scope, brandId);
  }

  @Post(':provider/connect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async connect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('provider', zodPipe(paymentGatewayProviderSchema)) provider: PaymentGatewayProvider,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.gateways.connectManual(scope, brandId, provider);
    return { ok: true };
  }

  @Post(':provider/disconnect')
  @HttpCode(200)
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async disconnect(
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('provider', zodPipe(paymentGatewayProviderSchema)) provider: PaymentGatewayProvider,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.gateways.disconnect(scope, brandId, provider);
    return { ok: true };
  }
}
