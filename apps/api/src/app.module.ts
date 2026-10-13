import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountingModule } from './adapters/accounting/accounting.module.js';
import { GatewayModule } from './adapters/gateway/gateway.module.js';
import { MailModule } from './adapters/mail/mail.module.js';
import { StorageModule } from './adapters/storage/storage.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { ChecksModule } from './invoicing/checks/checks.module.js';
import { CustomersModule } from './invoicing/customers/customers.module.js';
import { DashboardModule } from './invoicing/dashboard/dashboard.module.js';
import { InvoicesModule } from './invoicing/invoices/invoices.module.js';
import { PublicModule } from './invoicing/pay-api/public.module.js';
import { PaymentsModule } from './invoicing/payments/payments.module.js';
import { BrandSettingsModule } from './invoicing/settings/brand-settings.module.js';
import { ZohoSyncModule } from './invoicing/zoho-sync/zoho-sync.module.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { BrandsModule } from './platform/brands/brands.module.js';
import { MerchantModule } from './platform/companies/merchant.module.js';
import { IntegrationsModule } from './platform/integrations/integrations.module.js';
import { AuthorisationGuard } from './platform/tenancy/authorisation.js';
import { TenancyModule } from './platform/tenancy/tenancy.module.js';
import { UsersModule } from './platform/users/users.module.js';

/**
 * Composition root.
 *
 * The dependency rule (TDD-001 §3.2) is one-directional: entry points depend on
 * application services, which depend on the domain, which depends only on
 * ports. Adapters implement ports and are bound here — this is the only file
 * that knows which concrete adapter is in use.
 *
 * Modules are grouped by owner: shared infrastructure and adapters, then the
 * platform (shared by every product), then each product. A product depends on
 * the platform; the platform never depends on a product.
 *
 * The authorisation guard is global, so a new controller is protected the
 * moment it exists and has to opt out explicitly.
 */
@Module({
  imports: [
    // Infrastructure and adapters
    ConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MailModule,
    AccountingModule,
    GatewayModule,
    HealthModule,

    // Platform
    TenancyModule,
    AuthModule,
    UsersModule,
    MerchantModule,
    BrandsModule,
    IntegrationsModule,

    // Product: invoicing (Sugrpay)
    BrandSettingsModule,
    CustomersModule,
    InvoicesModule,
    PaymentsModule,
    ChecksModule,
    PublicModule,
    ZohoSyncModule,
    DashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthorisationGuard }],
})
export class AppModule {}
