import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Product, type RequestScope } from '@platform/kernel';
import {
  type Action,
  type Resource,
  type Role,
  ROLES,
  checkAccess,
} from '@platform/platform-contracts';
import { SESSION_COOKIE, SessionService } from '../../auth/application/session.service.js';

export const PERMISSION_KEY = 'sugrpay:permission';
export const PUBLIC_KEY = 'sugrpay:public';
export const PRODUCT_KEY = 'platform:product';

/**
 * Marks a controller as belonging to a product. Every request to it then
 * needs (1) an active subscription to that product for the user's company and
 * (2) a role for that product on the user. The product role — not the user's
 * platform role — is what the permission check and the handler see.
 * authorisation-coverage.test.ts fails the build if a product controller
 * forgets it.
 */
export const ProductScope = (product: Product) => SetMetadata(PRODUCT_KEY, product);

export interface PermissionRequirement {
  readonly resource: Resource;
  readonly action: Action;
  /** Where to find the brand id on the request. Defaults to params.brandId. */
  readonly brandFrom?: 'params' | 'query' | 'body' | 'none';
  readonly brandKey?: string;
}

/**
 * Declares what a handler needs. The generated authorisation matrix test
 * (NFR-SEC-012) enumerates every route and fails the build on any protected
 * route that carries no requirement — which is why this is metadata rather
 * than an if-statement inside the handler.
 */
export const RequirePermission = (
  resource: Resource,
  action: Action,
  options: Omit<PermissionRequirement, 'resource' | 'action'> = {},
) => SetMetadata(PERMISSION_KEY, { resource, action, ...options } satisfies PermissionRequirement);

/** Marks a route as intentionally unauthenticated (health, webhooks, payment page). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface ScopedRequest extends Request {
  scope?: RequestScope;
}

/** Injects the resolved scope. Throws if used on a route the guard did not run on. */
export const CurrentScope = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<ScopedRequest>();
  if (!request.scope) {
    throw new UnauthorizedException('no request scope resolved');
  }
  return request.scope;
});

/**
 * AuthorisationGuard — layer one of the three isolation layers (TDD-001 §6.1).
 *
 * Runs before any handler. It resolves the session, populates an immutable
 * scope, then evaluates the permission matrix and brand assignment. Denial is
 * server-side; hiding navigation is not access control (FR-AUTH-021).
 */
@Injectable()
export class AuthorisationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException('authentication required');

    const resolved = await this.sessions.resolve(token, request.ip ?? null);
    if (!resolved) throw new UnauthorizedException('authentication required');

    const product = this.reflector.getAllAndOverride<Product | undefined>(PRODUCT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const scope = product ? productScope(resolved, product) : resolved;

    request.scope = Object.freeze(scope);

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // A protected route with no declared requirement is a bug, not a route that
    // everyone may reach. Fail closed.
    if (!requirement) {
      throw new ForbiddenException(
        'route declares no permission requirement; add @RequirePermission or @Public',
      );
    }

    const decision = checkAccess({
      role: scope.role,
      resource: requirement.resource,
      action: requirement.action,
      assignedBrandIds: scope.assignedBrandIds,
      brandId: resolveBrandId(request, requirement),
    });

    if (!decision.allowed) {
      // The same message for both reasons: distinguishing them would confirm a
      // brand id exists to someone who cannot reach it.
      throw new ForbiddenException('insufficient permissions');
    }

    return true;
  }
}

/**
 * The scope a product endpoint works with. Throws 403 when the company has no
 * active subscription to the product, or the user holds no role in it.
 *
 * Invoicing's roles are the six-role matrix, so the invoicing role replaces
 * the platform role for the permission check. Other products bring their own
 * role sets; until they have a matrix, their requests keep the platform role
 * for the check and carry the product role in productRoles.
 */
export function productScope(scope: RequestScope, product: Product): RequestScope {
  if (!scope.products?.includes(product)) {
    throw new ForbiddenException('your company is not subscribed to this product');
  }
  const productRole = scope.productRoles?.[product];
  if (!productRole) {
    throw new ForbiddenException('you have no access to this product');
  }
  if (product === 'INVOICING') {
    if (!(ROLES as readonly string[]).includes(productRole)) {
      throw new ForbiddenException('you have no access to this product');
    }
    return { ...scope, role: productRole as Role, product };
  }
  return { ...scope, product };
}

function extractToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();

  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function resolveBrandId(request: Request, requirement: PermissionRequirement): string | null {
  const from = requirement.brandFrom ?? 'params';
  if (from === 'none') return null;

  const key = requirement.brandKey ?? 'brandId';

  // The default is "the brand is in the URL". A route that takes the default
  // but has no such path segment would otherwise resolve null and skip the
  // brand check entirely — silently letting a brand-scoped role act on any
  // brand. That is a declaration bug, so fail closed instead: the route must
  // say brandFrom 'none' (merchant-wide), 'query' or 'body' explicitly.
  // (authorisation-coverage.test.ts catches the same mistake at build time.)
  if (from === 'params' && !Object.prototype.hasOwnProperty.call(request.params ?? {}, key)) {
    throw new ForbiddenException(
      `route declares a brand check on params.${key} but has no such path parameter`,
    );
  }
  const source =
    from === 'params'
      ? (request.params as Record<string, unknown>)
      : from === 'query'
        ? (request.query as Record<string, unknown>)
        : (request.body as Record<string, unknown> | undefined);

  const value = source?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
