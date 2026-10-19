/**
 * Request scope — the immutable object every scoped query is built from
 * (TDD-001 §6.1 and §6.2).
 *
 * Three layers enforce isolation: this scope on the request guard, repository
 * scoping that refuses an unscoped query, and PostgreSQL row-level security as
 * the backstop. This type is layer one, and it is deliberately not mutable
 * after resolution — nothing downstream may widen its own access.
 */

import type { Role } from './domain/roles.js';
import { coversAllBrands } from './domain/roles.js';

export interface RequestScope {
  readonly merchantId: string;
  readonly userId: string;
  readonly role: Role;
  /** Explicit assignments. Empty for all-brand roles, which do not need them. */
  readonly assignedBrandIds: readonly string[];
  readonly sessionId: string;
  readonly sourceIp: string | null;
}

/**
 * The scope of the anonymous public payment path. It carries no user and
 * exactly one brand, resolved from the invoice's public token, so a leaked
 * token cannot reach anything beyond that one invoice's brand.
 */
export interface PublicScope {
  readonly kind: 'PUBLIC';
  readonly merchantId: string;
  readonly brandId: string;
  readonly invoiceId: string;
  readonly sourceIp: string | null;
}

export type Scope = RequestScope | PublicScope;

export function isPublicScope(scope: Scope): scope is PublicScope {
  return 'kind' in scope && scope.kind === 'PUBLIC';
}

/**
 * The brand ids a scope may read, or `null` meaning "every brand in the
 * merchant" — which the repository turns into a merchant_id predicate, never
 * into an absent predicate.
 */
export function readableBrandIds(scope: Scope): readonly string[] | null {
  if (isPublicScope(scope)) return [scope.brandId];
  return coversAllBrands(scope.role) ? null : scope.assignedBrandIds;
}

export function canReachBrand(scope: Scope, brandId: string): boolean {
  const brands = readableBrandIds(scope);
  return brands === null ? true : brands.includes(brandId);
}

/**
 * The settings pushed into the database session so row-level security can act.
 * Set on every connection checkout, inside the transaction, before any query.
 */
export interface DatabaseScopeSettings {
  readonly 'app.merchant_id': string;
  readonly 'app.brand_ids': string;
  readonly 'app.user_id': string;
  readonly 'app.all_brands': 'on' | 'off';
}

export function databaseScopeSettings(scope: Scope): DatabaseScopeSettings {
  if (isPublicScope(scope)) {
    return {
      'app.merchant_id': scope.merchantId,
      'app.brand_ids': scope.brandId,
      'app.user_id': '',
      'app.all_brands': 'off',
    };
  }
  const allBrands = coversAllBrands(scope.role);
  return {
    'app.merchant_id': scope.merchantId,
    'app.brand_ids': allBrands ? '' : scope.assignedBrandIds.join(','),
    'app.user_id': scope.userId,
    'app.all_brands': allBrands ? 'on' : 'off',
  };
}
