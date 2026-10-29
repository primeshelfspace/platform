import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { type RequestScope } from '@platform/kernel';
import {
  firstBrandSchema,
  registerCompanySchema,
  type FirstBrandInput,
  type OnboardingStep,
  type RegisterCompanyInput,
} from '@platform/platform-contracts';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission } from '@platform/server';
import {
  MerchantService,
  type CreatedBrandSummary,
  type MerchantOnboardingState,
} from '../application/merchant.service.js';

/**
 * Company onboarding: Register Your Company and Add Your Brand
 * (docs/product/stories/company-onboarding.md). Select Your Products is
 * ProductsController.
 */
@Controller('merchant')
export class MerchantController {
  constructor(private readonly merchant: MerchantService) {}

  /** Every user may read where onboarding stands: it decides where signing
   * in takes them. */
  @Get('onboarding')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  getOnboardingState(@CurrentScope() scope: RequestScope): Promise<MerchantOnboardingState> {
    return this.merchant.getOnboardingState(scope);
  }

  @Post('register-company')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  @HttpCode(200)
  registerCompany(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(registerCompanySchema)) body: RegisterCompanyInput,
  ): Promise<{ nextStep: OnboardingStep }> {
    return this.merchant.registerCompany(scope, body);
  }

  @Post('first-brand')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  addFirstBrand(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(firstBrandSchema)) body: FirstBrandInput,
  ): Promise<{ brand: CreatedBrandSummary; nextStep: OnboardingStep }> {
    return this.merchant.addFirstBrand(scope, body);
  }
}
