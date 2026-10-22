import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountingModule } from './shared/adapters/accounting/accounting.module.js';
import { GatewayModule } from './shared/adapters/gateway/gateway.module.js';
import { MailModule } from './shared/adapters/mail/mail.module.js';
import { StorageModule } from './shared/adapters/storage/storage.module.js';
import { ConfigModule } from './shared/config/config.module.js';
import { getEnv, type Env } from './shared/config/env.js';
import { HealthModule } from './shared/health/health.module.js';
import { EventsModule } from './shared/infra/events/events.module.js';
import { QueueModule } from './shared/infra/queue/queue.module.js';
import { RedisModule } from './shared/infra/redis/redis.module.js';
import { InvoicingModule } from './modules/invoicing/modules.js';
import { PlatformModule } from './modules/platform/modules.js';
import { AuthorisationGuard } from './modules/platform/public-api.js';
import { RateLimitGuard } from './shared/common/rate-limit.js';

/** Every product this API can run, by the name ENABLED_PRODUCTS uses. HQ
 * joins here when it exists. */
const PRODUCTS: Record<Env['ENABLED_PRODUCTS'][number], Type> = {
  invoicing: InvoicingModule,
};

/**
 * Composition root.
 *
 * The dependency rule (TDD-001 §3.2) is one-directional: entry points depend on
 * application services, which depend on the domain, which depends only on
 * ports. Adapters implement ports and are bound here — this is the only file
 * that knows which concrete adapter is in use.
 *
 * Above the adapters sit the platform (shared by every product, always on) and
 * one module per product, chosen by ENABLED_PRODUCTS. A product depends on the
 * platform; the platform never depends on a product; products never depend on
 * each other. Each is reached only through its public-api.ts / modules.ts
 * (enforced by src/module-boundaries.test.ts), and CI boots the platform with
 * no product at all to prove the second rule holds at runtime too.
 *
 * The authorisation guard is global, so a new controller is protected the
 * moment it exists and has to opt out explicitly.
 */
@Module({})
export class AppModule {
  static register(env: Env = getEnv()): DynamicModule {
    return {
      module: AppModule,
      imports: [
        // Infrastructure and adapters
        ConfigModule,
        EventsModule,
        RedisModule,
        QueueModule,
        StorageModule,
        MailModule,
        AccountingModule,
        GatewayModule,
        HealthModule,

        // Platform, then the enabled products
        PlatformModule,
        ...env.ENABLED_PRODUCTS.map((name) => PRODUCTS[name]),
      ],
      // Guards run in this order. Authorisation first, so a per-company
      // quota knows the company; public routes pass it without a lookup.
      providers: [
        { provide: APP_GUARD, useClass: AuthorisationGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
