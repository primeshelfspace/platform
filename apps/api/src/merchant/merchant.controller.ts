import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  brandStructureChoiceSchema,
  companyDetailsSchema,
  type BrandStructureChoiceInput,
  type CompanyDetailsInput,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  MerchantService,
  type CreatedBrandSummary,
  type MerchantOnboardingState,
} from './merchant.service.js';

@Controller('merchant')
export class MerchantController {
  constructor(private readonly merchant: MerchantService) {}

  /**
   * Read is ORGANISATION_PROFILE, not BRANDS — every role holds it (FRS-001
   * §3.3). This is polled by every dashboard page's onboarding guard, not
   * just the Owner/Admin actors who can actually complete these steps.
   */
  @Get('onboarding')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  getOnboardingState(@CurrentScope() scope: Scope): Promise<MerchantOnboardingState> {
    return this.merchant.getOnboardingState(scope);
  }

  @Patch('company-details')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  async setCompanyDetails(
    @CurrentScope() scope: Scope,
    @Body(zodPipe(companyDetailsSchema)) body: CompanyDetailsInput,
  ): Promise<{ ok: true }> {
    await this.merchant.setCompanyDetails(scope, body);
    return { ok: true };
  }

  @Post('logo')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(
    @CurrentScope() scope: Scope,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ logoUrl: string }> {
    if (!file) throw new BadRequestException('no file uploaded');
    return this.merchant.setLogo(scope, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Post('brand-structure')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  async chooseBrandStructure(
    @CurrentScope() scope: Scope,
    @Body(zodPipe(brandStructureChoiceSchema)) body: BrandStructureChoiceInput,
  ): Promise<{ brand: CreatedBrandSummary | null }> {
    const brand = await this.merchant.chooseBrandStructure(scope, body.structure);
    return { brand };
  }

  @Post('complete-onboarding')
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  async completeOnboarding(@CurrentScope() scope: Scope): Promise<{ ok: true }> {
    await this.merchant.completeOnboarding(scope);
    return { ok: true };
  }
}
