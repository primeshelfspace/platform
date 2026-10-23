import { Global, Inject, Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import {
  AuthorisationGuard,
  ENV,
  InternalCallError,
  InternalClient,
  SCOPE_RESOLVER,
  type Env,
  type ScopeResolver,
} from '@platform/server';

/**
 * Who is signed in, asked of the platform API — the same arrangement as
 * apps/sugrpay/src/modules/platform-access. When HQ gets its own copy of the
 * brands, brandInCompany reads it the way Sugrpay's does; until then it asks
 * nothing and refuses every brand, which is safe because HQ has no routes yet.
 */
@Injectable()
export class HqScopeResolver implements ScopeResolver {
  private readonly platform: InternalClient;

  constructor(@Inject(ENV) env: Env) {
    this.platform = new InternalClient(env.PLATFORM_INTERNAL_URL, env.INTERNAL_API_KEY ?? '');
  }

  async resolve(token: string, sourceIp: string | null): Promise<RequestScope | null> {
    try {
      const { scope } = await this.platform.request<{ scope: RequestScope | null }>(
        'POST',
        '/internal/sessions/resolve',
        { token, sourceIp },
      );
      return scope;
    } catch (error) {
      if (error instanceof InternalCallError) {
        throw new ServiceUnavailableException('sign-in service unavailable, please try again');
      }
      throw error;
    }
  }

  async brandInCompany(): Promise<boolean> {
    return false;
  }
}

@Global()
@Module({
  providers: [
    HqScopeResolver,
    { provide: SCOPE_RESOLVER, useExisting: HqScopeResolver },
    AuthorisationGuard,
  ],
  exports: [SCOPE_RESOLVER, AuthorisationGuard],
})
export class PlatformAccessModule {}
