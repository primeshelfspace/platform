import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  RESOURCES,
  ROLES,
  actionsFor,
  assignableRolesFor,
  can,
  grantsFor,
  hasGrant,
  checkAccess,
  coversAllBrands,
  mayAssignRole,
  rankOf,
} from './roles.js';

describe('permission matrix', () => {
  it('covers every role and resource', () => {
    for (const role of ROLES) {
      for (const resource of RESOURCES) {
        // Throws if the matrix has a hole.
        expect(() => can(role, resource, 'READ')).not.toThrow();
      }
    }
  });

  it('gives only the owner plan and billing rights', () => {
    expect(can('MERCHANT_OWNER', 'PLAN_AND_BILLING', 'READ')).toBe(true);
    for (const role of ROLES.filter((r) => r !== 'MERCHANT_OWNER')) {
      expect(can(role, 'PLAN_AND_BILLING', 'READ')).toBe(false);
    }
  });

  it('gives Read Only no write anywhere', () => {
    for (const resource of RESOURCES) {
      expect(can('READ_ONLY', resource, 'WRITE')).toBe(false);
      expect(can('READ_ONLY', resource, 'DELETE')).toBe(false);
      expect(can('READ_ONLY', resource, 'APPROVE')).toBe(false);
    }
  });

  it('lets Sales create invoices but not void or approve them', () => {
    expect(can('SALES_USER', 'INVOICES', 'WRITE')).toBe(true);
    expect(can('SALES_USER', 'INVOICES', 'DELETE')).toBe(false);
    expect(can('SALES_USER', 'INVOICES', 'APPROVE')).toBe(false);
    expect(can('SALES_USER', 'PAYMENTS', 'WRITE')).toBe(false);
  });

  it('lets Finance approve payments and checks but not configure', () => {
    expect(can('FINANCE_USER', 'PAYMENTS', 'APPROVE')).toBe(true);
    expect(can('FINANCE_USER', 'CHECK_APPROVAL', 'APPROVE')).toBe(true);
    expect(can('FINANCE_USER', 'BRAND_CONFIGURATION', 'WRITE')).toBe(false);
    expect(can('FINANCE_USER', 'TAX_AND_FEE_CONFIG', 'WRITE')).toBe(false);
  });

  it('keeps brand creation away from Brand Admin', () => {
    expect(can('BRAND_ADMIN', 'BRANDS', 'WRITE')).toBe(false);
    expect(can('BRAND_ADMIN', 'BRAND_CONFIGURATION', 'WRITE')).toBe(true);
  });

  it('restricts the audit log to owner, merchant admin and brand admin', () => {
    expect(can('MERCHANT_OWNER', 'AUDIT_LOG', 'READ')).toBe(true);
    expect(can('BRAND_ADMIN', 'AUDIT_LOG', 'READ')).toBe(true);
    expect(can('FINANCE_USER', 'AUDIT_LOG', 'READ')).toBe(false);
  });
});

describe('brand scope', () => {
  it('treats owner and merchant admin as covering all brands', () => {
    expect(coversAllBrands('MERCHANT_OWNER')).toBe(true);
    expect(coversAllBrands('MERCHANT_ADMIN')).toBe(true);
    expect(coversAllBrands('BRAND_ADMIN')).toBe(false);
  });

  it('denies a brand-scoped role outside its assignments', () => {
    expect(
      checkAccess({
        role: 'BRAND_ADMIN',
        resource: 'INVOICES',
        action: 'WRITE',
        assignedBrandIds: ['brand-a'],
        brandId: 'brand-b',
      }),
    ).toEqual({ allowed: false, reason: 'BRAND_NOT_ASSIGNED' });
  });

  it('allows a brand-scoped role inside its assignments', () => {
    expect(
      checkAccess({
        role: 'BRAND_ADMIN',
        resource: 'INVOICES',
        action: 'WRITE',
        assignedBrandIds: ['brand-a'],
        brandId: 'brand-a',
      }),
    ).toEqual({ allowed: true });
  });

  it('reports a role denial before a brand denial', () => {
    expect(
      checkAccess({
        role: 'READ_ONLY',
        resource: 'INVOICES',
        action: 'WRITE',
        assignedBrandIds: [],
        brandId: 'brand-b',
      }),
    ).toEqual({ allowed: false, reason: 'ROLE_LACKS_ACTION' });
  });

  it('ignores brand scope for an all-brand role', () => {
    expect(
      checkAccess({
        role: 'MERCHANT_ADMIN',
        resource: 'INVOICES',
        action: 'WRITE',
        assignedBrandIds: [],
        brandId: 'any-brand',
      }),
    ).toEqual({ allowed: true });
  });
});

describe('role assignment', () => {
  it('refuses assignment above the actor’s own rank', () => {
    expect(mayAssignRole('BRAND_ADMIN', 'MERCHANT_ADMIN')).toBe(false);
    expect(mayAssignRole('BRAND_ADMIN', 'SALES_USER')).toBe(true);
    expect(mayAssignRole('MERCHANT_OWNER', 'MERCHANT_OWNER')).toBe(true);
    expect(mayAssignRole('FINANCE_USER', 'READ_ONLY')).toBe(false);
  });
});

describe('permission grants (the shape /auth/me sends the client)', () => {
  it('agrees with can() for every role, resource and action', () => {
    for (const role of ROLES) {
      const grants = grantsFor(role);
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          expect(hasGrant(grants, resource, action)).toBe(can(role, resource, action));
        }
      }
    }
  });

  it('survives a JSON round trip unchanged', () => {
    const grants = grantsFor('FINANCE_USER');
    expect(JSON.parse(JSON.stringify(grants))).toEqual(grants);
  });

  it('denies everything when no grants are present', () => {
    expect(hasGrant(null, 'INVOICES', 'READ')).toBe(false);
    expect(hasGrant(undefined, 'INVOICES', 'READ')).toBe(false);
  });

  it('lists only the roles an actor may assign', () => {
    expect(assignableRolesFor('BRAND_ADMIN')).toEqual([
      'BRAND_ADMIN',
      'FINANCE_USER',
      'SALES_USER',
      'READ_ONLY',
    ]);
    expect(assignableRolesFor('MERCHANT_OWNER')).toEqual([...ROLES]);
    expect(assignableRolesFor('FINANCE_USER')).toEqual([]);
  });
});

describe('matrix introspection', () => {
  it('reports the exact action set a role holds on a resource', () => {
    expect([...actionsFor('FINANCE_USER', 'INVOICES')].sort()).toEqual(['DELETE', 'READ', 'WRITE']);
    expect([...actionsFor('READ_ONLY', 'INVOICE_SEND')]).toEqual([]);
  });

  it('ranks roles from owner down to read only', () => {
    const ordered = [...ROLES].sort((a, b) => rankOf(b) - rankOf(a));
    expect(ordered).toEqual([
      'MERCHANT_OWNER',
      'MERCHANT_ADMIN',
      'BRAND_ADMIN',
      'FINANCE_USER',
      'SALES_USER',
      'READ_ONLY',
    ]);
  });
});
