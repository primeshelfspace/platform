'use client';

import { type ReactNode, createContext, useContext } from 'react';
import { type Action, type PermissionGrants, type Resource, hasGrant } from '@sugrpay/shared';

/**
 * The signed-in user's permissions, as GET /auth/me returned them, made
 * available to every client component under AdminShell so a control the
 * user cannot use is never rendered in the first place.
 *
 * Server components use hasPermission() from lib/permissions.ts — same
 * grants, same answer. UX only: the API guard is the actual access control.
 */
const PermissionsContext = createContext<PermissionGrants | null>(null);

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: PermissionGrants;
  children: ReactNode;
}) {
  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

/** Outside a provider — or before grants load — it denies. */
export function useCan(resource: Resource, action: Action): boolean {
  return hasGrant(useContext(PermissionsContext), resource, action);
}
