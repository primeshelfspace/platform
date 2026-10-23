import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BrandsModule } from './brands/brands.module.js';
import { MerchantModule } from './companies/merchant.module.js';
import { PlatformDatabaseModule } from './database/platform-database.module.js';
import { PlatformEventsModule } from './events/platform-events.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { UsersModule } from './users/users.module.js';

/** Everything the platform contributes to the application: its database and
 * event outbox, login, companies, brands, users, subscriptions, locations,
 * tenancy and integration connections. */
@Module({
  imports: [
    PlatformDatabaseModule,
    PlatformEventsModule,
    AuditModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    MerchantModule,
    BrandsModule,
    IntegrationsModule,
    SubscriptionsModule,
    LocationsModule,
  ],
  exports: [TenancyModule, IntegrationsModule, BrandsModule, AuditModule],
})
export class PlatformModule {}
