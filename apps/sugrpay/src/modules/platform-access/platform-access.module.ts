import { Global, Module } from '@nestjs/common';
import { AuthorisationGuard, SCOPE_RESOLVER } from '@platform/server';
import { InternalEventsController } from './internal-events.controller.js';
import { PlatformApiClient } from './platform-api.client.js';
import {
  AuditLogService,
  BrandsService,
  RemoteScopeResolver,
  StripeAccountService,
  SystemScopeResolver,
} from './platform-services.js';

/**
 * Everything Sugrpay needs from the platform, reached over HTTP (never its
 * database): who is signed in, a brand's Stripe account, the audit log, brand
 * colours — plus the endpoint the platform delivers its events to.
 */
@Global()
@Module({
  controllers: [InternalEventsController],
  providers: [
    PlatformApiClient,
    RemoteScopeResolver,
    { provide: SCOPE_RESOLVER, useExisting: RemoteScopeResolver },
    AuthorisationGuard,
    SystemScopeResolver,
    AuditLogService,
    BrandsService,
    StripeAccountService,
  ],
  exports: [
    PlatformApiClient,
    SCOPE_RESOLVER,
    AuthorisationGuard,
    SystemScopeResolver,
    AuditLogService,
    BrandsService,
    StripeAccountService,
  ],
})
export class PlatformAccessModule {}
