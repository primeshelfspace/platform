import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthorisationGuard,
  ConfigModule,
  EventsModule,
  HealthModule,
  RateLimitGuard,
  RedisModule,
  StorageModule,
} from '@platform/server';
import { HqDatabaseModule } from './modules/database/hq-database.module.js';
import { PlatformSyncModule } from './modules/platform-sync/platform-sync.module.js';
import { PlatformAccessModule } from './platform-access/platform-access.module.js';

/**
 * The HQ API: its own program, port (HQ_API_PORT) and database (HQ_DATABASE_URL),
 * reaching the platform only over HTTP and its events, like Sugrpay. Common
 * data (companies, users, roles, brands) is the platform's; HQ keeps a copy of
 * the brands, fed by platform events, to join to. HQ's features (from its
 * stories) are added under src/modules/. See README.md and
 * docs/architecture/adding-a-product.md.
 */
@Module({
  imports: [
    ConfigModule,
    EventsModule,
    RedisModule,
    StorageModule,
    HealthModule,
    HqDatabaseModule,
    PlatformAccessModule,
    PlatformSyncModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthorisationGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
