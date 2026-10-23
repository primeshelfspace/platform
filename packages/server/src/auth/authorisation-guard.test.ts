/**
 * The AuthorisationGuard with the session lookup stubbed: public routes,
 * missing or unknown sessions, undeclared routes, the permission matrix,
 * brand assignment, and — for roles that cover every brand — brands of
 * another company.
 */
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RequestScope } from '@platform/kernel';
import { describe, expect, it } from 'vitest';
import {
  AuthorisationGuard,
  PERMISSION_KEY,
  PRODUCT_KEY,
  PUBLIC_KEY,
  SESSION_COOKIE,
  type ScopeResolver,
  type PermissionRequirement,
  type ScopedRequest,
} from './authorisation.js';

const OWN_BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const FOREIGN_BRAND = '99999999-9999-4999-8999-999999999999';

const scopeFor = (invoicingRole: string, brands: string[] = []): RequestScope => ({
  merchantId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  role: 'MERCHANT_OWNER',
  assignedBrandIds: brands,
  sessionId: '00000000-0000-4000-8000-000000000003',
  sourceIp: null,
  products: ['INVOICING'],
  productRoles: { INVOICING: invoicingRole },
});

interface Route {
  isPublic?: boolean;
  product?: string;
  requirement?: PermissionRequirement;
}

function guardFor(route: Route, scope: RequestScope | null): AuthorisationGuard {
  const metadata: Record<string, unknown> = {
    [PUBLIC_KEY]: route.isPublic,
    [PRODUCT_KEY]: route.product,
    [PERMISSION_KEY]: route.requirement,
  };
  const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
  const sessions = {
    resolve: async (token: string) => (token === 'good' ? scope : null),
    // The stubbed company owns exactly these two brands.
    brandInCompany: async (_scope: RequestScope, brandId: string) =>
      [OWN_BRAND, OTHER_BRAND].includes(brandId),
  } as unknown as ScopeResolver;
  return new AuthorisationGuard(reflector, sessions);
}

function contextFor(request: Record<string, unknown>): ExecutionContext {
  const full = { headers: {}, params: {}, query: {}, body: {}, ip: '127.0.0.1', ...request };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => full }),
  } as unknown as ExecutionContext;
}

const withToken = (brandId?: string, token = 'good') => ({
  headers: { authorization: `Bearer ${token}` },
  params: brandId === undefined ? {} : { brandId },
});

const readInvoices: Route = {
  product: 'INVOICING',
  requirement: { resource: 'INVOICES', action: 'READ' },
};

describe('AuthorisationGuard', () => {
  it('lets a public route through without a session', async () => {
    await expect(guardFor({ isPublic: true }, null).canActivate(contextFor({}))).resolves.toBe(
      true,
    );
  });

  it('answers 401 with no token, an unknown token, or the token in a different cookie', async () => {
    const guard = guardFor(readInvoices, scopeFor('MERCHANT_OWNER'));
    await expect(guard.canActivate(contextFor({ params: { brandId: OWN_BRAND } }))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextFor(withToken(OWN_BRAND, 'guessed')))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(
        contextFor({ headers: { cookie: 'other=good' }, params: { brandId: OWN_BRAND } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts the session cookie as well as a bearer token', async () => {
    const guard = guardFor(readInvoices, scopeFor('MERCHANT_OWNER'));
    await expect(
      guard.canActivate(
        contextFor({
          headers: { cookie: `${SESSION_COOKIE}=good` },
          params: { brandId: OWN_BRAND },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('fails closed on a protected route that declares no permission', async () => {
    const guard = guardFor({}, scopeFor('MERCHANT_OWNER'));
    await expect(guard.canActivate(contextFor(withToken()))).rejects.toThrow(ForbiddenException);
  });

  it('fails closed on a brand check whose path parameter does not exist', async () => {
    const guard = guardFor(readInvoices, scopeFor('MERCHANT_OWNER'));
    await expect(guard.canActivate(contextFor(withToken()))).rejects.toThrow(ForbiddenException);
  });

  it('lets an owner reach every brand of their own company', async () => {
    const guard = guardFor(readInvoices, scopeFor('MERCHANT_OWNER'));
    for (const brandId of [OWN_BRAND, OTHER_BRAND]) {
      await expect(guard.canActivate(contextFor(withToken(brandId)))).resolves.toBe(true);
    }
  });

  it('refuses an owner or admin a brand of another company, and a malformed brand id', async () => {
    for (const role of ['MERCHANT_OWNER', 'MERCHANT_ADMIN']) {
      const guard = guardFor(readInvoices, scopeFor(role));
      for (const brandId of [FOREIGN_BRAND, 'not-a-uuid']) {
        await expect(guard.canActivate(contextFor(withToken(brandId)))).rejects.toThrow(
          ForbiddenException,
        );
      }
    }
  });

  it('keeps a brand-scoped role to its assigned brands', async () => {
    const guard = guardFor(readInvoices, scopeFor('READ_ONLY', [OWN_BRAND]));
    await expect(guard.canActivate(contextFor(withToken(OWN_BRAND)))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(withToken(OTHER_BRAND)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses an action the role does not have', async () => {
    const guard = guardFor(
      { product: 'INVOICING', requirement: { resource: 'INVOICES', action: 'WRITE' } },
      scopeFor('READ_ONLY', [OWN_BRAND]),
    );
    await expect(guard.canActivate(contextFor(withToken(OWN_BRAND)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a product the company is not subscribed to', async () => {
    const guard = guardFor(readInvoices, { ...scopeFor('MERCHANT_OWNER'), products: [] });
    await expect(guard.canActivate(contextFor(withToken(OWN_BRAND)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('freezes the scope it hands to the handler', async () => {
    const context = contextFor(withToken(OWN_BRAND));
    await guardFor(readInvoices, scopeFor('MERCHANT_OWNER')).canActivate(context);
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    expect(Object.isFrozen(request.scope)).toBe(true);
  });
});
