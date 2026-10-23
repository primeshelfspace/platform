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
import { InternalModule } from './modules/internal/internal.module.js';
import { PlatformModule } from './modules/platform.module.js';

/**
 * The platform API: sign-in, companies, brands, locations, users and roles,
 * subscriptions, and the Stripe/Square/Authorize.Net connections — what every
 * product shares. It has its own database (platform) and depends on no
 * product. Products (apps/sugrpay, apps/hq) are separate programs that reach
 * it only over HTTP: the public routes, or /internal for API-to-API calls.
 *
 * The authorisation guard is global, so a new controller is protected the
 * moment it exists and has to opt out explicitly.
 */
@Module({
  imports: [
    ConfigModule,
    EventsModule,
    RedisModule,
    StorageModule,
    MailModule,
    HealthModule,
    PlatformModule,
    InternalModule,
  ],
  // Guards run in this order. Authorisation first, so a per-company quota
  // knows the company; public routes pass it without a lookup.
  providers: [
    { provide: APP_GUARD, useClass: AuthorisationGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
