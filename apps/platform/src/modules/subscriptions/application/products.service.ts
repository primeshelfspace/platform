import { ConflictException, Inject, Injectable } from '@nestjs/common';
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
import { SessionService } from '../../auth/application/session.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

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
  /** The 12-hour JWT the product sends with every platform call. */
  readonly token: string;
  readonly expiresAt: string;
  /** Gets a new JWT when it expires (POST /product-session/refresh). */
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
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
    private readonly sessions: SessionService,
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
   * company. Any user of the company may continue. Starts a product session
   * (Product Session story): a 12-hour JWT naming the user (`sub`), the
   * company (`mid`), the product (`aud`) and the session (`sid`), and a
   * refresh token for the next one.
   */
  async continueInto(
    scope: RequestScope,
    product: Product,
    context: { sourceIp?: string | null; userAgent?: string | null } = {},
  ): Promise<ProductLaunch> {
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
    const session = await this.sessions.issueProductSession(scope, product, context);
    return { product, url, ...session };
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
