'use client';

import { useActionState, useEffect, type FormEvent } from 'react';
import { ROLES, rankOf, type Role } from '@fenwick/shared';
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
  currentUserRole,
  canWrite,
  canSuspend,
  brandNameById,
  onChanged,
  onAssignBrands,
}: {
  user: ManagedUser;
  currentUserId: string;
  currentUserRole: string;
  canWrite: boolean;
  canSuspend: boolean;
  brandNameById: Map<string, string>;
  onChanged: (user: ManagedUser) => void;
  onAssignBrands: (user: ManagedUser) => void;
}) {
  const isSelf = user.id === currentUserId;
  const actorRank = rankOf(currentUserRole as Role);
  // Mirrors mayAssignRole on the server: never offer a role above the actor's
  // own rank, and never offer editing someone who already outranks them.
  const editableRole = canWrite && !isSelf && rankOf(user.role as Role) <= actorRank;
  const assignableRoles = ROLES.filter((role) => rankOf(role) <= actorRank);

  const roleAction = updateUserRoleAction.bind(null, user.id);
  const [roleState, roleFormAction, rolePending] = useActionState(roleAction, initialState);
  useFormStatusToast(roleState, 'Role updated.');
  useEffect(() => {
    if (roleState.user) onChanged(roleState.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleState.user]);

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

  const brandLabel = user.assignedBrandIds.length
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
          <form action={roleFormAction} className="inline-flex items-center gap-2">
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
          {canWrite && !isSelf && (
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
