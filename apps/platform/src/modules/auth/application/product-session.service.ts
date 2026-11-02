import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Product, RequestScope } from '@platform/kernel';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { askingProduct, roleInProduct } from './product-access.js';
import { SessionService, type ProductTokens } from './session.service.js';

export interface ProductUserDetails {
  /** The details held on the account; for a sign-up account, the sign-in email. */
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  /** The Company the user is signed in to. */
  readonly companyId: string;
  /** The product the JWT was issued to. */
  readonly product: Product;
  /** COMPANY_ADMIN for the Company Admin; otherwise the role in this product only. */
  readonly role: string;
  /** When the JWT expires (ISO); refresh it then. */
  readonly expiresAt: string;
}

/**
 * Product Session — User Details & Tokens (docs/product/stories/product-session.md).
 * The JWT itself is checked by the request guard (SessionService.resolve):
 * signature, expiry, a live product session, and the product still enabled.
 */
@Injectable()
export class ProductSessionService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Who is signed in, the Company, and their role, from the JWT alone. Read
   * fresh on every call, so a changed role shows at once. Company details and
   * Brands are not here (Company Profile has them).
   */
  async details(scope: RequestScope): Promise<ProductUserDetails> {
    const product = askingProduct(scope);
    const role = roleInProduct(scope, product);
    const user = await this.prisma.withScope(scope, (tx) =>
      tx.user.findUnique({
        where: { id: scope.userId },
        select: { id: true, name: true, email: true },
      }),
    );
    if (!user || !role) {
      throw new ForbiddenException({
        message: 'you have no access to this product',
        code: 'NO_PRODUCT_ACCESS',
      });
    }
    return {
      user,
      companyId: scope.merchantId,
      product,
      role,
      expiresAt: scope.tokenExpiresAt!,
    };
  }

  /** A new 12-hour JWT for the refresh token; see SessionService. */
  refresh(refreshToken: string): Promise<ProductTokens> {
    return this.sessions.refreshProductToken(refreshToken);
  }
}
