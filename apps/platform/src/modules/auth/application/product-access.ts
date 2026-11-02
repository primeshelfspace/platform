import { ForbiddenException } from '@nestjs/common';
import type { Product, RequestScope } from '@platform/kernel';

/**
 * The role a product sees for the Company Admin (the account that signed the
 * company up, MERCHANT_OWNER): company-level access, not a role in any one
 * product.
 */
export const COMPANY_ADMIN_ROLE = 'COMPANY_ADMIN';

/**
 * The product asking, from its JWT (Product Session story). The product APIs
 * know which product is asking only from the token, so they refuse a platform
 * session that carries none.
 */
export function askingProduct(scope: RequestScope): Product {
  if (!scope.tokenProduct) {
    throw new ForbiddenException({
      message: "call this with the product's JWT",
      code: 'PRODUCT_TOKEN_REQUIRED',
    });
  }
  return scope.tokenProduct;
}

/**
 * A user's role as one product sees it: Company Admin for the company's own
 * account, otherwise their role in that product only (never another
 * product's). Null when they hold none there.
 */
export function roleInProduct(
  user: {
    readonly role: string;
    readonly productRoles?: Readonly<Partial<Record<Product, string>>>;
  },
  product: Product,
): string | null {
  if (user.role === 'MERCHANT_OWNER') return COMPANY_ADMIN_ROLE;
  return user.productRoles?.[product] ?? null;
}
