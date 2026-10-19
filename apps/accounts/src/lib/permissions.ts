import type { Action, Resource } from '@platform/platform-contracts';
import type { CurrentUser } from './api';

/** What the API said this user may do — never re-derived from the role. */
export function can(user: CurrentUser, resource: Resource, action: Action): boolean {
  return (user.permissions[resource] ?? []).includes(action);
}
