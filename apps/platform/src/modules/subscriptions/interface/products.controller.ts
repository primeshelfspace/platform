import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Product, type RequestScope } from '@platform/kernel';
import {
  enableProductsSchema,
  productSchema,
  type EnableProductsInput,
} from '@platform/platform-contracts';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission } from '@platform/server';
import {
  ProductsService,
  type EnabledProducts,
  type ProductLaunch,
  type ProductsView,
} from '../application/products.service.js';

/**
 * Select Your Products & Redirect. Every signed-in user sees the products and
 * may continue into an enabled one; only the Company Admin enables them
 * (checked in ProductsService as well as by the permission here).
 */
@Controller('company/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  list(@CurrentScope() scope: RequestScope): Promise<ProductsView> {
    return this.products.list(scope);
  }

  @Post()
  @RequirePermission('PLAN_AND_BILLING', 'WRITE', { brandFrom: 'none' })
  @HttpCode(200)
  enable(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(enableProductsSchema)) body: EnableProductsInput,
  ): Promise<EnabledProducts> {
    return this.products.enable(scope, body.products);
  }

  @Post(':product/continue')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  @HttpCode(200)
  continueInto(
    @CurrentScope() scope: RequestScope,
    @Param('product', zodPipe(productSchema)) product: Product,
  ): Promise<ProductLaunch> {
    return this.products.continueInto(scope, product);
  }
}
