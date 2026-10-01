/**
 * Roles, resources and the permission matrix (FRS-001 §3.2 and §3.3).
 *
 * Permissions are computed, never stored per user (TDD-001 §7.2). A user holds
 * a role and a set of brand assignments; the effective permission set is
 * derived from this matrix at request time, so a matrix change takes effect
 * immediately without a data migration.
 *
 * The matrix is the single source of truth for the generated authorisation test
 * (NFR-SEC-012): every role × every endpoint. An endpoint added without a
 * matrix entry fails the build rather than shipping unguarded.
 */

export const ROLES = [
  'MERCHANT_OWNER',
  'MERCHANT_ADMIN',
  'BRAND_ADMIN',
  'FINANCE_USER',
  'SALES_USER',
  'READ_ONLY',
] as const;
export type Role = (typeof ROLES)[number];

export const RESOURCES = [
  'ORGANISATION_PROFILE',
  'PLAN_AND_BILLING',
  'USERS',
  'BRANDS',
  'BRAND_CONFIGURATION',
  'TEMPLATES',
  'CUSTOM_DOMAIN',
  'INTEGRATIONS',
  'CUSTOMERS',
  'INVOICES',
  'INVOICE_SEND',
  'PAYMENTS',
  'CHECK_APPROVAL',
  'TAX_AND_FEE_CONFIG',
  'REPORTS',
  'AUDIT_LOG',
  'SYSTEM_ADMINISTRATION',
] as const;
export type Resource = (typeof RESOURCES)[number];

/** R = read, W = create/update, D = delete/void, A = approve. */
export const ACTIONS = ['READ', 'WRITE', 'DELETE', 'APPROVE'] as const;
export type Action = (typeof ACTIONS)[number];

const ACTION_BY_LETTER: Record<string, Action> = {
  R: 'READ',
  W: 'WRITE',
  D: 'DELETE',
  A: 'APPROVE',
};

/**
 * FRS-001 §3.3, transcribed. Column order matches ROLES. An empty string means
 * no access at all.
 *
 *   * Brand Admin may assign users only to brands they administer, and only to
 *     roles at or below their own — enforced in UserService, not expressible here.
 *  ** Brand Admin sees audit entries for assigned brands only — enforced by the
 *     brand scope on the query, not by the matrix.
 */
const MATRIX: Record<Resource, readonly [string, string, string, string, string, string]> = {
  ORGANISATION_PROFILE: ['RWD', 'R', 'R', 'R', 'R', 'R'],
  PLAN_AND_BILLING: ['RWD', '', '', '', '', ''],
  USERS: ['RWD', 'RWD', 'RW', '', '', ''],
  BRANDS: ['RWD', 'RWD', 'R', 'R', 'R', 'R'],
  BRAND_CONFIGURATION: ['RWD', 'RWD', 'RWD', 'R', 'R', 'R'],
  TEMPLATES: ['RWD', 'RWD', 'RWD', 'R', 'R', 'R'],
  CUSTOM_DOMAIN: ['RWD', 'RWD', 'RWD', '', '', ''],
  INTEGRATIONS: ['RWD', 'RWD', 'RWD', 'R', '', ''],
  CUSTOMERS: ['RWD', 'RWD', 'RWD', 'RW', 'RW', 'R'],
  INVOICES: ['RWDA', 'RWDA', 'RWDA', 'RWD', 'RW', 'R'],
  INVOICE_SEND: ['W', 'W', 'W', 'W', 'W', ''],
  PAYMENTS: ['RWDA', 'RWDA', 'RWDA', 'RWA', 'R', 'R'],
  CHECK_APPROVAL: ['A', 'A', 'A', 'A', '', ''],
  TAX_AND_FEE_CONFIG: ['RWD', 'RWD', 'RWD', 'R', '', ''],
  REPORTS: ['R', 'R', 'R', 'R', 'R', 'R'],
  AUDIT_LOG: ['R', 'R', 'R', '', '', ''],
  SYSTEM_ADMINISTRATION: ['RWD', 'R', '', '', '', ''],
};

const PERMISSIONS: Record<Role, Record<Resource, ReadonlySet<Action>>> = buildPermissions();

function buildPermissions(): Record<Role, Record<Resource, ReadonlySet<Action>>> {
  const out = {} as Record<Role, Record<Resource, ReadonlySet<Action>>>;
  for (const [roleIndex, role] of ROLES.entries()) {
    const perResource = {} as Record<Resource, ReadonlySet<Action>>;
    for (const resource of RESOURCES) {
      const cell = MATRIX[resource][roleIndex] ?? '';
      perResource[resource] = new Set(
        [...cell].map((letter) => {
          const action = ACTION_BY_LETTER[letter];
          if (!action) throw new Error(`unknown permission letter "${letter}" on ${resource}`);
          return action;
        }),
      );
    }
    out[role] = perResource;
  }
  return out;
}

/** Roles whose scope is every brand in the merchant (FRS-001 §3.2). */
const ALL_BRAND_ROLES: ReadonlySet<Role> = new Set<Role>(['MERCHANT_OWNER', 'MERCHANT_ADMIN']);

export function coversAllBrands(role: Role): boolean {
  return ALL_BRAND_ROLES.has(role);
}

/** Does the role permit this action on this resource, ignoring brand scope? */
export function can(role: Role, resource: Resource, action: Action): boolean {
  return PERMISSIONS[role][resource].has(action);
}

export function actionsFor(role: Role, resource: Resource): ReadonlySet<Action> {
  return PERMISSIONS[role][resource];
}

/** Seniority, used for "may only assign roles at or below their own". */
const RANK: Record<Role, number> = {
  MERCHANT_OWNER: 6,
  MERCHANT_ADMIN: 5,
  BRAND_ADMIN: 4,
  FINANCE_USER: 3,
  SALES_USER: 2,
  READ_ONLY: 1,
};

export function rankOf(role: Role): number {
  return RANK[role];
}

export function mayAssignRole(actor: Role, target: Role): boolean {
  return can(actor, 'USERS', 'WRITE') && RANK[actor] >= RANK[target];
}

/**
 * A role's effective permissions in a JSON-safe shape — what the API hands
 * the client (GET /auth/me) so the UI renders from the server's decision
 * rather than re-deriving it from a role string. Every resource is present;
 * an empty array means no access.
 */
export type PermissionGrants = Readonly<Record<Resource, readonly Action[]>>;

export function grantsFor(role: Role): PermissionGrants {
  const out = {} as Record<Resource, readonly Action[]>;
  for (const resource of RESOURCES) {
    // ACTIONS order, not Set insertion order, so the payload is stable.
    out[resource] = ACTIONS.filter((action) => PERMISSIONS[role][resource].has(action));
  }
  return out;
}

/** The client-side counterpart of can(): reads grants, never the matrix. */
export function hasGrant(
  grants: PermissionGrants | null | undefined,
  resource: Resource,
  action: Action,
): boolean {
  return grants?.[resource]?.includes(action) ?? false;
}

/** Every role this actor may hand out — the invite and role pickers' options. */
export function assignableRolesFor(actor: Role): Role[] {
  return ROLES.filter((target) => mayAssignRole(actor, target));
}

export interface AccessRequest {
  readonly role: Role;
  readonly resource: Resource;
  readonly action: Action;
  /** Assigned brand ids. Ignored for all-brand roles. */
  readonly assignedBrandIds: readonly string[];
  /** The brand the request targets, when it targets one. */
  readonly brandId?: string | null;
}

export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'ROLE_LACKS_ACTION' | 'BRAND_NOT_ASSIGNED' };

/**
 * The full check: matrix, then brand scope. Step 4 and 5 of TDD-001 §6.2.
 * Brand scope is evaluated after the matrix so that a denial reads as
 * "the role cannot do this" rather than leaking which brands exist.
 */
export function checkAccess(request: AccessRequest): AccessDecision {
  if (!can(request.role, request.resource, request.action)) {
    return { allowed: false, reason: 'ROLE_LACKS_ACTION' };
  }
  if (request.brandId == null || coversAllBrands(request.role)) {
    return { allowed: true };
  }
  return request.assignedBrandIds.includes(request.brandId)
    ? { allowed: true }
    : { allowed: false, reason: 'BRAND_NOT_ASSIGNED' };
}
