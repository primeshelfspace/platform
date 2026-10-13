import { Global, Module } from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { AuthorisationGuard } from './authorisation.js';
import { SystemScopeResolver } from './system-scope.js';

/**
 * The guard is registered globally in main.ts / app.module.ts rather than
 * per-controller, so a new controller is protected by default and has to opt
 * out with @Public() rather than opt in.
 */
@Global()
@Module({
  providers: [SessionService, AuthorisationGuard, SystemScopeResolver],
  exports: [SessionService, AuthorisationGuard, SystemScopeResolver],
})
export class TenancyModule {}
