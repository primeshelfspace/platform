import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountingModule } from './adapters/accounting/accounting.module.js';
import { GatewayModule } from './adapters/gateway/gateway.module.js';
import { MailModule } from './adapters/mail/mail.module.js';
import { StorageModule } from './adapters/storage/storage.module.js';
import { ConfigModule } from './config/config.module.js';
import { getEnv, type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { EventsModule } from './infra/events/events.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { InvoicingModule } from './invoicing/modules.js';
import { PlatformModule } from './platform/modules.js';
import { AuthorisationGuard } from './platform/public-api.js';

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
      providers: [{ provide: APP_GUARD, useClass: AuthorisationGuard }],
    };
  }
}
