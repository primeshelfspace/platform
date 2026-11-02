import { Module } from '@nestjs/common';
import { CompanyProfileService } from './application/company-profile.service.js';
import { ProductBrandsService } from './application/product-brands.service.js';
import { ProductRolesService } from './application/product-roles.service.js';
import { ProductUsersService } from './application/product-users.service.js';
import { CompanyProfileController } from './interface/company-profile.controller.js';
import { ProductBrandsController } from './interface/product-brands.controller.js';
import { ProductRolesController } from './interface/product-roles.controller.js';
import { ProductUsersController } from './interface/product-users.controller.js';

/**
 * The platform APIs a product (HQ or Sugrpay) calls with its JWT to read and
 * manage its Company: Company Profile, Brand Management, User Management,
 * User List and Role List (docs/product/stories/product-company-apis.md).
 * Every endpoint needs the product's JWT; the product is known from it.
 */
@Module({
  controllers: [
    CompanyProfileController,
    ProductBrandsController,
    ProductUsersController,
    ProductRolesController,
  ],
  providers: [
    CompanyProfileService,
    ProductBrandsService,
    ProductUsersService,
    ProductRolesService,
  ],
})
export class ProductCompanyModule {}
