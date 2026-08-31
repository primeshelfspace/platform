import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountingModule } from './adapters/accounting/accounting.module.js';
import { GatewayModule } from './adapters/gateway/gateway.module.js';
import { MailModule } from './adapters/mail/mail.module.js';
import { StorageModule } from './adapters/storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BrandsModule } from './brands/brands.module.js';
import { ConfigModule } from './config/config.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { HealthModule } from './health/health.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { MerchantModule } from './merchant/merchant.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PublicModule } from './public/public.module.js';
import { AuthorisationGuard } from './tenancy/authorisation.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

/**
 * Composition root.
 *
 * The dependency rule (TDD-001 §3.2) is one-directional: entry points depend on
 * application services, which depend on the domain, which depends only on
 * ports. Adapters implement ports and are bound here — this is the only file
 * that knows which concrete adapter is in use.
 *
 * The authorisation guard is global, so a new controller is protected the
 * moment it exists and has to opt out explicitly.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    TenancyModule,
    StorageModule,
    MailModule,
    AccountingModule,
    GatewayModule,
    HealthModule,
    AuthModule,
    BrandsModule,
    MerchantModule,
    CustomersModule,
    InvoicesModule,
    PaymentsModule,
    PublicModule,
    IntegrationsModule,
    DashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthorisationGuard }],
})
export class AppModule {}
