import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { BrandsModule } from './brands/brands.module.js';
import { MerchantModule } from './companies/merchant.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { UsersModule } from './users/users.module.js';

/** Everything the platform contributes to the application: login, companies,
 * brands, users, tenancy and integration connections. */
@Module({
  imports: [TenancyModule, AuthModule, UsersModule, MerchantModule, BrandsModule, IntegrationsModule],
  exports: [TenancyModule, IntegrationsModule],
})
export class PlatformModule {}
