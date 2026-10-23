import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthorisationGuard,
  ConfigModule,
  EventsModule,
  HealthModule,
  MailModule,
  RateLimitGuard,
  RedisModule,
  StorageModule,
} from '@platform/server';
import { AccountingModule } from './adapters/accounting/accounting.module.js';
import { GatewayModule } from './adapters/gateway/gateway.module.js';
import { SugrpayHealthModule } from './health/sugrpay-health.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { InvoicingModule } from './modules/invoicing.module.js';
import { PlatformAccessModule } from './modules/platform-access/index.js';

/**
 * The Sugrpay API: customers, invoices, payments, checks, the public payment
 * page, brand settings and Zoho Books sync. Its own program with its own
 * database (invoicing). Who is signed in, a brand's Stripe account and the
 * audit log belong to the platform API, asked over HTTP (PlatformAccessModule);
 * Sugrpay never reads the platform's database.
 *
 * The authorisation guard is global, so a new controller is protected the
 * moment it exists and has to opt out explicitly.
 */
@Module({
  imports: [
    ConfigModule,
    EventsModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MailModule,
    AccountingModule,
    GatewayModule,
    HealthModule,
    PlatformAccessModule,
    InvoicingModule,
    SugrpayHealthModule,
  ],
  // Guards run in this order. Authorisation first, so a per-company quota
  // knows the company; public routes pass it without a lookup.
  providers: [
    { provide: APP_GUARD, useClass: AuthorisationGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
