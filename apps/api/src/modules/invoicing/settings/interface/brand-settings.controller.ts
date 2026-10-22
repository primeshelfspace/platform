import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  brandSettingsSchema,
  emailReceiptSettingsSchema,
  emailReceiptTestSendSchema,
  invoicePdfSettingsSchema,
  paymentMethodSettingsSchema,
  paymentPageDisplaySchema,
  type EmailReceiptSettingsInput,
  type EmailReceiptTestSendInput,
  type InvoicePdfSettingsInput,
  type PaymentMethodSettingsInput,
  type PaymentPageDisplayInput,
} from '@platform/invoicing-contracts';
import { idSchema, type Scope } from '@platform/kernel';
import { zodPipe } from '../../../../shared/common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission, ProductScope } from '../../../platform/public-api.js';
import {
  BrandSettingsService,
  type EmailReceiptSettings,
  type InvoicePdfSettings,
  type PaymentMethodSettings,
  type PaymentPageDisplaySettings,
} from '../application/brand-settings.service.js';
import { RateLimit } from '../../../../shared/common/rate-limit.js';

const invoiceNumberingSchema = z.object({
  invoicePrefix: brandSettingsSchema.shape.invoicePrefix,
});

@ProductScope('INVOICING')
@Controller('brands/:brandId/settings')
export class BrandSettingsController {
  constructor(private readonly settings: BrandSettingsService) {}

  /**
   * Sets the invoice-number prefix for a brand that has not numbered an
   * invoice yet — the "create brand" flow calls it right after the platform
   * creates the brand, since the prefix is an invoicing setting and the
   * platform does not hold it. Gated like brand creation itself.
   */
  @Put('invoice-numbering')
  @RequirePermission('BRANDS', 'WRITE')
  setInvoiceNumbering(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(invoiceNumberingSchema)) body: { invoicePrefix: string },
  ): Promise<{ invoicePrefix: string }> {
    return this.settings.setInitialInvoicePrefix(scope, brandId, body.invoicePrefix);
  }

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
  @RateLimit({ name: 'receipt-test-send', windowSeconds: 86400, perCompanyLimit: 30 })
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

  @Get('invoice-pdf')
  @RequirePermission('BRAND_CONFIGURATION', 'READ')
  getInvoicePdf(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<InvoicePdfSettings> {
    return this.settings.getInvoicePdfSettings(scope, brandId);
  }

  @Patch('invoice-pdf')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  updateInvoicePdf(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(invoicePdfSettingsSchema)) body: InvoicePdfSettingsInput,
  ): Promise<InvoicePdfSettings> {
    return this.settings.updateInvoicePdfSettings(scope, brandId, body);
  }
}
