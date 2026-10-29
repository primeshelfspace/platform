import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { PRODUCTS, PRODUCT_NAMES, type Product, type RequestScope } from '@platform/kernel';
import { PRODUCT_DESCRIPTIONS } from '@platform/platform-contracts';
import { ENV, type Env } from '@platform/server';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import {
  requireCompanyAdmin,
  requireReadyForProducts,
} from '../../companies/application/merchant.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** How long the JWT carried into a product is good for. The product exchanges
 * or refreshes it (Product Session story); this one only has to get there. */
export const PRODUCT_TOKEN_TTL_SECONDS = 15 * 60;

/** Who issues the product JWT, as its `iss`. */
export const PRODUCT_TOKEN_ISSUER = 'platform';

export interface ProductCard {
  readonly product: Product;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** The Company Admin may enable it (it is not enabled yet). */
  readonly canEnable: boolean;
}

export interface ProductsView {
  readonly products: ProductCard[];
  readonly onboardingComplete: boolean;
}

export interface EnabledProducts extends ProductsView {
  /** Open this product straight away: exactly one is enabled. Otherwise the
   * user picks with Continue. */
  readonly continueWith: Product | null;
}

export interface ProductLaunch {
  readonly product: Product;
  /** Where to send the user; the token goes in the URL fragment. */
  readonly url: string;
  readonly token: string;
  readonly expiresAt: string;
}

/** The top role a Company Admin gets in a product they enable. */
const ADMIN_ROLE_IN: Record<Product, (scope: RequestScope) => string> = {
  INVOICING: (scope) => scope.role,
  HQ: () => 'EXECUTIVE',
};

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ message, code });
}

/**
 * Select Your Products & Redirect (docs/product/stories/company-onboarding.md):
 * the fixed product list, enabling products, and continuing into one with a
 * JWT. The last onboarding step: enabling the first product completes it.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly outbox: PlatformOutbox,
    private readonly subscriptions: SubscriptionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(scope: RequestScope): Promise<ProductsView> {
    return this.prisma.withScope(scope, (tx) => this.view(tx, scope));
  }

  /**
   * Enables exactly the products given, for the Company Admin only, and only
   * once the company is registered and has an active brand. Products already
   * enabled stay as they are; the others are untouched. The first enabled
   * product completes onboarding.
   */
  async enable(scope: RequestScope, products: readonly Product[]): Promise<EnabledProducts> {
    requireCompanyAdmin(scope);
    const view = await this.prisma.withScope(scope, async (tx) => {
      await requireReadyForProducts(tx, scope.merchantId);
      for (const product of products) {
        const subscription = await this.subscriptions.save(tx, scope.merchantId, product, {
          status: 'ACTIVE',
        });
        await this.outbox.recordSubscription(tx, subscription);
        await tx.userProductRole.upsert({
          where: { userId_product: { userId: scope.userId, product } },
          create: { userId: scope.userId, product, role: ADMIN_ROLE_IN[product](scope) },
          update: {},
        });
      }
      await tx.merchant.update({
        where: { id: scope.merchantId },
        data: { onboardingComplete: true },
      });
      return this.view(tx, scope);
    });
    await this.outbox.flush();
    const enabled = view.products.filter((p) => p.enabled);
    return { ...view, continueWith: enabled.length === 1 ? enabled[0]!.product : null };
  }

  /**
   * Continue into a product: a JWT for it, only if it is enabled for the
   * company. Any user of the company may continue. The token is short-lived
   * and names the user (`sub`), the company (`mid`) and the product (`aud`).
   */
  async continueInto(scope: RequestScope, product: Product): Promise<ProductLaunch> {
    const enabled = await this.prisma.withScope(scope, (tx) =>
      tx.subscription.findFirst({
        where: { merchantId: scope.merchantId, product, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
    if (!enabled) {
      throw conflict(
        'PRODUCT_NOT_ENABLED',
        `${PRODUCT_NAMES[product]} is not enabled for this company`,
      );
    }
    const url = this.urlOf(product);
    if (!url) {
      throw conflict('PRODUCT_NOT_AVAILABLE', `${PRODUCT_NAMES[product]} isn't available yet`);
    }
    const secret = this.env.PRODUCT_JWT_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'product sign-in is not configured (PRODUCT_JWT_SECRET)',
      );
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + PRODUCT_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ mid: scope.merchantId, role: scope.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(PRODUCT_TOKEN_ISSUER)
      .setAudience(product)
      .setSubject(scope.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(new TextEncoder().encode(secret));
    return { product, url, token, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  private urlOf(product: Product): string | null {
    return product === 'INVOICING' ? this.env.ADMIN_PUBLIC_URL : (this.env.HQ_PUBLIC_URL ?? null);
  }

  private async view(tx: ScopedClient, scope: RequestScope): Promise<ProductsView> {
    const [subscriptions, merchant] = await Promise.all([
      tx.subscription.findMany({ where: { merchantId: scope.merchantId, status: 'ACTIVE' } }),
      tx.merchant.findUniqueOrThrow({
        where: { id: scope.merchantId },
        select: { onboardingComplete: true },
      }),
    ]);
    const active = new Set(subscriptions.map((s) => s.product));
    const isAdmin = scope.role === 'MERCHANT_OWNER';
    return {
      onboardingComplete: merchant.onboardingComplete,
      products: PRODUCTS.map((product) => ({
        product,
        name: PRODUCT_NAMES[product],
        description: PRODUCT_DESCRIPTIONS[product],
        enabled: active.has(product),
        canEnable: isAdmin && !active.has(product),
      })),
    };
  }
}
