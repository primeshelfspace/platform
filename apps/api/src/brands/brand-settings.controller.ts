import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  emailReceiptSettingsSchema,
  emailReceiptTestSendSchema,
  idSchema,
  paymentMethodSettingsSchema,
  paymentPageDisplaySchema,
  type EmailReceiptSettingsInput,
  type EmailReceiptTestSendInput,
  type PaymentMethodSettingsInput,
  type PaymentPageDisplayInput,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  BrandSettingsService,
  type EmailReceiptSettings,
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

  @Get('email-receipt')
  @RequirePermission('BRAND_CONFIGURATION', 'READ')
  getEmailReceipt(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<EmailReceiptSettings> {
    return this.settings.getEmailReceiptSettings(scope, brandId);
  }

  @Patch('email-receipt')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  updateEmailReceipt(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(emailReceiptSettingsSchema)) body: EmailReceiptSettingsInput,
  ): Promise<EmailReceiptSettings> {
    return this.settings.updateEmailReceiptSettings(scope, brandId, body);
  }

  @Post('email-receipt/test-send')
  @HttpCode(200)
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  async sendEmailReceiptTest(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(emailReceiptTestSendSchema)) body: EmailReceiptTestSendInput,
  ): Promise<{ sent: true }> {
    await this.settings.sendEmailReceiptTest(scope, brandId, body);
    return { sent: true };
  }
}
