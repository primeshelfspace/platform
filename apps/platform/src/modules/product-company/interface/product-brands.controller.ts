import { Body, Controller, HttpCode, Param, Post, Put } from '@nestjs/common';
import { idSchema, type RequestScope } from '@platform/kernel';
import { firstBrandSchema } from '@platform/platform-contracts';
import { CurrentScope, RequirePermission, zodPipe } from '@platform/server';
import {
  ProductBrandsService,
  type AddedBrand,
  type ProductBrandInput,
} from '../application/product-brands.service.js';
import type { ProductBrand } from '../application/company-profile.service.js';

/**
 * Brand Management — add, edit and archive Brands from a product, with the
 * product's JWT. BRANDS WRITE lets the guard through for brand-managing
 * roles (and checks a :brandId is the Company's); ProductBrandsService then
 * allows the Company Admin only.
 */
@Controller('company/brands')
export class ProductBrandsController {
  constructor(private readonly brands: ProductBrandsService) {}

  @Post()
  @RequirePermission('BRANDS', 'WRITE', { brandFrom: 'none' })
  add(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(firstBrandSchema)) body: ProductBrandInput,
  ): Promise<AddedBrand> {
    return this.brands.add(scope, body);
  }

  @Put(':brandId')
  @RequirePermission('BRANDS', 'WRITE')
  edit(
    @CurrentScope() scope: RequestScope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(firstBrandSchema)) body: ProductBrandInput,
  ): Promise<ProductBrand> {
    return this.brands.edit(scope, brandId, body);
  }

  @Post(':brandId/archive')
  @RequirePermission('BRANDS', 'WRITE')
  @HttpCode(200)
  archive(
    @CurrentScope() scope: RequestScope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<ProductBrand> {
    return this.brands.archive(scope, brandId);
  }
}
