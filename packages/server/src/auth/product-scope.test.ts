/**
 * The product check the AuthorisationGuard runs on every @ProductScope'd
 * controller: subscription first, then the user's role in that product.
 */
import { ForbiddenException } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import { describe, expect, it } from 'vitest';
import { productScope } from './authorisation.js';

const base: RequestScope = {
  merchantId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
  role: 'MERCHANT_OWNER',
  assignedBrandIds: [],
  sessionId: '00000000-0000-0000-0000-000000000003',
  sourceIp: null,
  products: ['INVOICING'],
  productRoles: { INVOICING: 'READ_ONLY' },
};

describe('productScope', () => {
  it('refuses a company without an active subscription to the product', () => {
    expect(() => productScope({ ...base, products: [] }, 'INVOICING')).toThrow(ForbiddenException);
  });

  it('refuses a user without a role in the product', () => {
    expect(() => productScope({ ...base, productRoles: {} }, 'INVOICING')).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a subscribed product the user has no role in, even as platform owner', () => {
    expect(() => productScope({ ...base, products: ['INVOICING', 'HQ'] }, 'HQ')).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an invoicing role that is not one of the invoicing roles', () => {
    expect(() =>
      productScope({ ...base, productRoles: { INVOICING: 'EXECUTIVE' } }, 'INVOICING'),
    ).toThrow(ForbiddenException);
  });

  it('uses the invoicing role, not the platform role, for invoicing requests', () => {
    const scope = productScope(base, 'INVOICING');
    expect(scope.role).toBe('READ_ONLY');
    expect(scope.product).toBe('INVOICING');
  });

  it('keeps the platform role for a product with its own role set', () => {
    const scope = productScope(
      { ...base, products: ['INVOICING', 'HQ'], productRoles: { HQ: 'MANAGER' } },
      'HQ',
    );
    expect(scope.role).toBe('MERCHANT_OWNER');
    expect(scope.product).toBe('HQ');
    expect(scope.productRoles?.HQ).toBe('MANAGER');
  });
});
