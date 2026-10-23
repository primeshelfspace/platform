import { Global, Module } from '@nestjs/common';
import { AuthorisationGuard, SCOPE_RESOLVER } from '@platform/server';
import { SessionService } from '../auth/application/session.service.js';
import { SystemScopeResolver } from './application/system-scope.js';

/**
 * The request guard, with the platform's own session table behind it. Product
 * APIs run the same guard but resolve sessions by asking this API
 * (POST /internal/sessions/resolve) — they never read these tables.
 */
@Global()
@Module({
  providers: [
    SessionService,
    { provide: SCOPE_RESOLVER, useExisting: SessionService },
    AuthorisationGuard,
    SystemScopeResolver,
  ],
  exports: [SessionService, SCOPE_RESOLVER, AuthorisationGuard, SystemScopeResolver],
})
export class TenancyModule {}
