'use server';

import {
  inviteUser,
  updateUserBrands,
  updateUserRole,
  updateUserStatus,
  type ManagedUser,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

export interface InviteUserState {
  readonly error?: string;
  readonly user?: ManagedUser;
}

/**
 * The Invite User modal's action. Never redirects — the modal stays mounted
 * and reads `user` off the returned state to close itself and refresh the
 * table, the same pattern createCustomerAction uses for Add Customer.
 */
export async function inviteUserAction(
  _prevState: InviteUserState,
  formData: FormData,
): Promise<InviteUserState> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '');
  const brandIds = formData.getAll('brandIds').map(String);

  if (!name) return { error: 'Enter a name.' };
  if (!email) return { error: 'Enter an email address.' };
  if (!role) return { error: 'Choose a role.' };

  try {
    const user = await inviteUser({ name, email, role, brandIds });
    return { user };
  } catch (error) {
    return { error: describeActionError(error, 'Could not invite this user.') };
  }
}

export interface UpdateUserState {
  readonly error?: string;
  readonly success?: boolean;
  readonly user?: ManagedUser;
}

export async function updateUserRoleAction(
  userId: string,
  _prevState: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const role = String(formData.get('role') ?? '');
  if (!role) return { error: 'Choose a role.' };

  try {
    const user = await updateUserRole(userId, role);
    return { success: true, user };
  } catch (error) {
    return { error: describeActionError(error, 'Could not change this role.') };
  }
}

export async function updateUserBrandsAction(
  userId: string,
  _prevState: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const brandIds = formData.getAll('brandIds').map(String);

  try {
    const user = await updateUserBrands(userId, brandIds);
    return { success: true, user };
  } catch (error) {
    return { error: describeActionError(error, 'Could not update brand assignments.') };
  }
}

/**
 * Suspend/reactivate — a one-field hidden form (status), same useActionState
 * shape as the others so the row's own button can show a pending state and
 * the app-wide toast reports the result, with no modal involved.
 */
export async function updateUserStatusAction(
  userId: string,
  _prevState: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const status = formData.get('status') === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';

  try {
    const user = await updateUserStatus(userId, status);
    return { success: true, user };
  } catch (error) {
    return { error: describeActionError(error, 'Could not update this account.') };
  }
}
