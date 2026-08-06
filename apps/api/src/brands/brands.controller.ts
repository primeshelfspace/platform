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
import type { Brand } from '@prisma/client';
import {
  brandObjectSchema,
  brandSchema,
  brandSettingsSchema,
  idSchema,
  TAX_ID_FORMAT_MESSAGE,
  taxIdMatchesCountry,
  type BrandInput,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import { BrandsService, type BrandWithLogo, type CreateBrandInput } from './brands.service.js';

/**
 * NOTE for whoever builds brand-scoped screens for Brand Admin / Finance /
 * Sales / Read Only next: this list is gated on BRANDS READ, which per the
 * FRS-001 §3.3 matrix only Owner and Merchant Admin hold. Those roles need a
 * lighter "brands I am assigned to" read to drive their own brand switcher —
 * that is a distinct permission from "list every brand in the organisation"
 * and deserves its own resource/decision, not a quiet loosening of BRANDS.
 */
const createBrandSchema = brandObjectSchema
  .extend({ invoicePrefix: brandSettingsSchema.shape.invoicePrefix })
  .refine(taxIdMatchesCountry, { message: TAX_ID_FORMAT_MESSAGE, path: ['taxId'] });

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
    @Body(zodPipe(createBrandSchema)) body: CreateBrandInput,
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
