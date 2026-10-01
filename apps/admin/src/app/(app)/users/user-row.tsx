'use client';

import { useActionState, useEffect, type FormEvent } from 'react';
import { coversAllBrands, type Role } from '@fenwick/shared';
import { Select } from '@/components/ui/select';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import type { ManagedUser } from '@/lib/api';
import { ROLE_LABELS } from './role-labels';
import { updateUserRoleAction, updateUserStatusAction, type UpdateUserState } from './actions';

const initialState: UpdateUserState = {};

const STATUS_BADGE_CLASS: Record<ManagedUser['status'], string> = {
  ACTIVE: 'bg-success-surface text-success',
  INVITED: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-danger-surface text-danger',
};

export function UserRow({
  user,
  currentUserId,
  assignableRoles,
  canWrite,
  canSuspend,
  brandNameById,
  onChanged,
  onAssignBrands,
}: {
  user: ManagedUser;
  currentUserId: string;
  /** From GET /auth/me — the API's mayAssignRole for the signed-in actor. */
  assignableRoles: Role[];
  canWrite: boolean;
  canSuspend: boolean;
  brandNameById: Map<string, string>;
  onChanged: (user: ManagedUser) => void;
  /** Opens the brand picker; `role` set means "collect brands for this role
   * change" rather than plain assignment editing. */
  onAssignBrands: (user: ManagedUser, role?: Role) => void;
}) {
  const isSelf = user.id === currentUserId;
  // Same rule as the API: the actor must be able to assign both the user's
  // current role and the new one, so someone who outranks them is read-only.
  const editableRole = canWrite && !isSelf && assignableRoles.includes(user.role as Role);
  // Owner and Merchant Admin cover every brand and hold no assignment rows —
  // the API rejects a brand edit for them outright.
  const userCoversAllBrands = coversAllBrands(user.role as Role);
  const editableBrands = editableRole && !userCoversAllBrands;

  const roleAction = updateUserRoleAction.bind(null, user.id);
  const [roleState, roleFormAction, rolePending] = useActionState(roleAction, initialState);
  useFormStatusToast(roleState, 'Role updated.');
  useEffect(() => {
    if (roleState.user) onChanged(roleState.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleState.user]);

  /** Owner/Admin → brand-scoped: the API requires brands in the same
   * request (an account with a brand-scoped role and no brands sees
   * nothing), so hand off to the brand picker, which submits both. */
  function handleRoleSubmit(event: FormEvent<HTMLFormElement>) {
    const next = new FormData(event.currentTarget).get('role') as Role | null;
    if (next && userCoversAllBrands && !coversAllBrands(next)) {
      event.preventDefault();
      onAssignBrands(user, next);
    }
  }

  const statusAction = updateUserStatusAction.bind(null, user.id);
  const [statusState, statusFormAction, statusPending] = useActionState(statusAction, initialState);
  useFormStatusToast(
    statusState,
    user.status === 'SUSPENDED' ? 'Account reactivated.' : 'Account suspended.',
  );
  useEffect(() => {
    if (statusState.user) onChanged(statusState.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusState.user]);

  function handleStatusSubmit(event: FormEvent<HTMLFormElement>) {
    if (user.status !== 'SUSPENDED') {
      const confirmed = window.confirm(`Suspend ${user.name}? They will not be able to sign in.`);
      if (!confirmed) event.preventDefault();
    }
  }

  const brandLabel = userCoversAllBrands
    ? 'All brands'
    : user.assignedBrandIds.length
      ? user.assignedBrandIds.map((id) => brandNameById.get(id) ?? '—').join(', ')
      : '—';

  return (
    <tr className="border-b border-[#E5E7EB] last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium text-ink-strong">{user.name}</p>
        <p className="text-sm text-ink-muted">{user.email}</p>
      </td>
      <td className="px-4 py-3">
        {editableRole ? (
          <form
            action={roleFormAction}
            onSubmit={handleRoleSubmit}
            className="inline-flex items-center gap-2"
          >
            <Select key={user.role} name="role" compact defaultValue={user.role}>
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              disabled={rolePending}
              className="text-sm font-medium text-ink-strong underline disabled:text-ink-muted"
            >
              {rolePending ? 'Saving…' : 'Save'}
            </button>
          </form>
        ) : (
          <span className="text-sm text-ink-strong">
            {ROLE_LABELS[user.role as Role] ?? user.role}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink-muted">{brandLabel}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[user.status]}`}
        >
          {user.status}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {editableBrands && (
            <button
              type="button"
              onClick={() => onAssignBrands(user)}
              className="text-sm font-medium text-ink-strong underline"
            >
              Brands
            </button>
          )}
          {canSuspend && !isSelf && (
            <form action={statusFormAction} onSubmit={handleStatusSubmit}>
              <input
                type="hidden"
                name="status"
                value={user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'}
              />
              <button
                type="submit"
                disabled={statusPending}
                className="text-sm font-medium text-danger underline disabled:text-ink-muted"
              >
                {statusPending ? 'Saving…' : user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}
