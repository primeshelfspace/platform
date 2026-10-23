import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RequestScope, Scope } from '@platform/kernel';
import { ENV, InternalCallError, type Env, type ScopeResolver } from '@platform/server';
import Stripe from 'stripe';
import { InvoicingPrismaService } from '../database/invoicing-prisma.service.js';
import { PlatformApiClient, type AuditEntry } from './platform-api.client.js';

export type { AuditEntry };

/** Stripe's API version, matching the platform's (they share one account). */
export const STRIPE_API_VERSION = '2025-02-24.acacia';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request guard's session lookup for Sugrpay: the platform owns sessions,
 * so each request asks it. "Is this brand one of the caller's company's?" is
 * answered from Sugrpay's own copy of the brands (kept current by platform
 * events), so it costs no extra call.
 */
@Injectable()
export class RemoteScopeResolver implements ScopeResolver {
  constructor(
    private readonly platform: PlatformApiClient,
    private readonly prisma: InvoicingPrismaService,
  ) {}

  async resolve(token: string, sourceIp: string | null): Promise<RequestScope | null> {
    try {
      return await this.platform.resolveSession(token, sourceIp);
    } catch (error) {
      // The platform being unreachable is not "signed out": answer 503 (try
      // again), never a 401 that would send the user to the sign-in page.
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

/**
 * A scope for work no user started (webhooks, scheduled sync) — the brand's
 * company, acting as its owner. Read from Sugrpay's copy of the brands.
 */
@Injectable()
export class SystemScopeResolver {
  constructor(private readonly prisma: InvoicingPrismaService) {}

  async forBrand(brandId: string, actor: string): Promise<RequestScope | null> {
    if (!UUID.test(brandId)) return null;
    const brand = await this.prisma.ownerClient.brand.findUnique({
      where: { id: brandId },
      select: { merchantId: true },
    });
    if (!brand) return null;
    return {
      merchantId: brand.merchantId,
      userId: `system:${actor}`,
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: `system:${actor}`,
      sourceIp: null,
    };
  }
}

/** The platform's audit log, written through the platform API. */
@Injectable()
export class AuditLogService {
  constructor(private readonly platform: PlatformApiClient) {}

  record(scope: Scope, entry: AuditEntry): Promise<void> {
    return this.platform.recordAudit(scope, entry);
  }
}

/** Brand fields Sugrpay's settings screens edit but the platform owns. */
@Injectable()
export class BrandsService {
  constructor(private readonly platform: PlatformApiClient) {}

  setThemeColor(scope: Scope, brandId: string, themeColor: string): Promise<void> {
    return this.platform.setThemeColor(scope, brandId, themeColor);
  }
}

/**
 * Stripe for card payments. The connected account of each brand is the
 * platform's record (it runs the Connect flow), asked for over HTTP; the
 * platform's own Stripe keys are configuration both APIs read.
 */
@Injectable()
export class StripeAccountService {
  constructor(
    private readonly platform: PlatformApiClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  getAccountIdForBrand(brandId: string): Promise<string | null> {
    return this.platform.stripeAccountForBrand(brandId);
  }

  findBrandIdByAccountId(accountId: string): Promise<string | null> {
    return this.platform.brandForStripeAccount(accountId);
  }

  platformClient(): Stripe {
    if (!this.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    return new Stripe(this.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
  }

  /** Safe to hand to the browser; publishable keys are not secret. */
  platformPublishableKey(): string | null {
    return this.env.STRIPE_PUBLISHABLE_KEY ?? null;
  }
}
