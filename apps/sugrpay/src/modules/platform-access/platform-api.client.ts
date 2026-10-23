import { Inject, Injectable } from '@nestjs/common';
import type { RequestScope, Scope } from '@platform/kernel';
import { ENV, InternalClient, type Env } from '@platform/server';

/** An audit entry, as the platform's audit log takes it. */
export interface AuditEntry {
  readonly brandId: string | null;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string | null;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly metadata?: Record<string, unknown>;
}

/**
 * Sugrpay's only way to the platform: its /internal HTTP routes, on the same
 * machine, with the shared INTERNAL_API_KEY. Sugrpay never reads the
 * platform's database (see apps/platform/src/modules/internal).
 */
@Injectable()
export class PlatformApiClient {
  private readonly client: InternalClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = new InternalClient(env.PLATFORM_INTERNAL_URL, env.INTERNAL_API_KEY ?? '');
  }

  async resolveSession(token: string, sourceIp: string | null): Promise<RequestScope | null> {
    const { scope } = await this.client.request<{ scope: RequestScope | null }>(
      'POST',
      '/internal/sessions/resolve',
      { token, sourceIp },
    );
    return scope;
  }

  async stripeAccountForBrand(brandId: string): Promise<string | null> {
    const { accountId } = await this.client.request<{ accountId: string | null }>(
      'GET',
      `/internal/brands/${encodeURIComponent(brandId)}/stripe-account`,
    );
    return accountId;
  }

  async brandForStripeAccount(accountId: string): Promise<string | null> {
    const { brandId } = await this.client.request<{ brandId: string | null }>(
      'GET',
      `/internal/stripe-accounts/${encodeURIComponent(accountId)}/brand`,
    );
    return brandId;
  }

  async setThemeColor(scope: Scope, brandId: string, themeColor: string): Promise<void> {
    await this.client.request(
      'POST',
      `/internal/brands/${encodeURIComponent(brandId)}/theme-color`,
      {
        scope,
        themeColor,
      },
    );
  }

  async recordAudit(scope: Scope, entry: AuditEntry): Promise<void> {
    await this.client.request('POST', '/internal/audit', { scope, entry });
  }
}
