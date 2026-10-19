/**
 * The role and permission matrix lives in @platform/kernel, because the
 * tenancy scope every module shares is built from it. Re-exported here so it
 * is part of what the platform publishes.
 */
export {
  ACTIONS,
  RESOURCES,
  ROLES,
  actionsFor,
  assignableRolesFor,
  can,
  checkAccess,
  coversAllBrands,
  grantsFor,
  hasGrant,
  mayAssignRole,
  rankOf,
  type AccessDecision,
  type AccessRequest,
  type Action,
  type PermissionGrants,
  type Resource,
  type Role,
} from '@platform/kernel';
