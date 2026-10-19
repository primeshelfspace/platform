import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { idSchema, type Scope } from '@platform/kernel';
import {
  brandObjectSchema,
  brandSchema,
  TAX_ID_FORMAT_MESSAGE,
  taxIdMatchesCountry,
  type BrandInput,
} from '@platform/platform-contracts';
import { zodPipe } from '../../../../shared/common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../../tenancy/interface/authorisation.js';
import { BrandsService, type Brand, type BrandWithLogo } from '../application/brands.service.js';

// No invoicePrefix: that is an invoicing setting, saved through invoicing's
// PUT /brands/:brandId/settings/invoice-numbering once the brand exists.
const createBrandSchema = brandObjectSchema.refine(taxIdMatchesCountry, {
  message: TAX_ID_FORMAT_MESSAGE,
  path: ['taxId'],
});

@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermission('BRANDS', 'READ', { brandFrom: 'none' })
  list(@CurrentScope() scope: Scope): Promise<BrandWithLogo[]> {
    return this.brands.list(scope);
  }

  @Post()
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  create(
    @CurrentScope() scope: Scope,
    @Body(zodPipe(createBrandSchema)) body: BrandInput,
  ): Promise<Brand> {
    return this.brands.create(scope, body);
  }

  /**
   * Full replace, the same shape create() takes — no partial-patch schema,
   * so a field this form doesn't show (taxId, billingAddress, currency,
   * timezone, businessType) has to come back exactly as it went out, not be
   * silently reset to a schema default by an incomplete body.
   */
  @Patch(':brandId')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  update(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(brandSchema)) body: BrandInput,
  ): Promise<Brand> {
    return this.brands.update(scope, brandId, body);
  }

  @Post(':brandId/logo')
  @RequirePermission('BRAND_CONFIGURATION', 'WRITE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ logoUrl: string }> {
    if (!file) throw new BadRequestException('no file uploaded');
    return this.brands.setLogo(scope, brandId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
  }
}
