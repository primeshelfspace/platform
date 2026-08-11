import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  idSchema,
  paymentMethodSettingsSchema,
  paymentPageDisplaySchema,
  type PaymentMethodSettingsInput,
  type PaymentPageDisplayInput,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  BrandSettingsService,
  type PaymentMethodSettings,
  type PaymentPageDisplaySettings,
} from './brand-settings.service.js';

@Controller('brands/:brandId/settings')
export class BrandSettingsController {
  constructor(private readonly settings: BrandSettingsService) {}

  @Get('payment-methods')
  @RequirePermission('BRAND_CONFIGURATION', 'READ')
  getPaymentMethods(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<PaymentMethodSettings> {
    return this.settings.getPaymentMethods(scope, brandId);
  }

  @Patch('payment-methods')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  updatePaymentMethods(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(paymentMethodSettingsSchema)) body: PaymentMethodSettingsInput,
  ): Promise<PaymentMethodSettings> {
    return this.settings.updatePaymentMethods(scope, brandId, body);
  }

  @Get('payment-page-display')
  @RequirePermission('BRAND_CONFIGURATION', 'READ')
  getPaymentPageDisplay(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<PaymentPageDisplaySettings> {
    return this.settings.getPaymentPageDisplay(scope, brandId);
  }

  @Patch('payment-page-display')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  updatePaymentPageDisplay(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(paymentPageDisplaySchema)) body: PaymentPageDisplayInput,
  ): Promise<PaymentPageDisplaySettings> {
    return this.settings.updatePaymentPageDisplay(scope, brandId, body);
  }
}
