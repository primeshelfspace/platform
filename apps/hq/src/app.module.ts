import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthorisationGuard,
  ConfigModule,
  HealthModule,
  RateLimitGuard,
  RedisModule,
  StorageModule,
} from '@platform/server';
import { PlatformAccessModule } from './platform-access/platform-access.module.js';

/**
 * The HQ API — not built yet. This is the empty frame it will grow in: its
 * own program, port (HQ_API_PORT) and, once it has data, its own database,
 * reaching the platform only over HTTP like Sugrpay does. Today it answers
 * /health only. See README.md and docs/architecture/adding-a-product.md.
 */
@Module({
  imports: [ConfigModule, RedisModule, StorageModule, HealthModule, PlatformAccessModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthorisationGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
