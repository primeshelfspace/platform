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
import { HqPrismaService } from '../modules/database/hq-prisma.service.js';
import { InternalEventsController } from './internal-events.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who is signed in, asked of the platform API — the same arrangement as
 * apps/sugrpay/src/modules/platform-access. Whether a brand is the company's
 * is read from HQ's own copy of the brands, as Sugrpay does.
 */
@Injectable()
export class HqScopeResolver implements ScopeResolver {
  private readonly platform: InternalClient;

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: HqPrismaService,
  ) {
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

  async brandInCompany(scope: RequestScope, brandId: string): Promise<boolean> {
    if (!UUID.test(brandId)) return false;
    const brand = await this.prisma.ownerClient.brand.findFirst({
      where: { id: brandId, merchantId: scope.merchantId },
      select: { id: true },
    });
    return brand !== null;
  }
}

@Global()
@Module({
  controllers: [InternalEventsController],
  providers: [
    HqScopeResolver,
    { provide: SCOPE_RESOLVER, useExisting: HqScopeResolver },
    AuthorisationGuard,
  ],
  exports: [SCOPE_RESOLVER, AuthorisationGuard],
})
export class PlatformAccessModule {}
