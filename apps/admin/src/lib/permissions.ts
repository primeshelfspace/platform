import { hasGrant, type Action, type Resource } from '@fenwick/shared';
import type { CurrentUser } from './api';

/**
 * The admin app's single answer to "may this user do X" — for server
 * components and server actions. Client components use useCan() from
 * hooks/use-permissions, which reads the same grants.
 *
 * Reads the permissions GET /auth/me returned, never the role: the API
 * computes them from the same matrix and the same request scope its guard
 * enforces, so what the UI shows and what the API allows cannot drift.
 * Like every client-side check this is UX only — the API guard is the
 * actual access control (apps/api/src/tenancy/authorisation.ts).
 */
export function hasPermission(
  user: Pick<CurrentUser, 'permissions'> | null | undefined,
  resource: Resource,
  action: Action,
): boolean {
  return hasGrant(user?.permissions, resource, action);
}
