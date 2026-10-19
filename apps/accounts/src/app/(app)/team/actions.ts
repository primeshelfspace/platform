'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { emailSchema } from '@platform/kernel';
import { ROLES, isProduct, type Product, type Role } from '@platform/platform-contracts';
import {
  ApiError,
  inviteUser,
  updateProductRole,
  updateUserBrands,
  updateUserLocations,
  updateUserStatus,
} from '@/lib/api';

/**
 * Team changes. Every rule (who may grant which role, brand scoping, the
 * last-owner check) lives in the API; these actions only carry the result
 * back to the page as ?saved or ?error.
 */

function back(path: string, outcome: { saved?: string; error?: string }): never {
  const qs = new URLSearchParams(outcome as Record<string, string>);
  revalidatePath('/team');
  redirect(`${path}?${qs.toString()}`);
}

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Try again.';
}

export async function inviteAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '');
  const hqRole = String(formData.get('hqRole') ?? '');
  const brandIds = formData.getAll('brandIds').map(String);

  if (!name) back('/team', { error: 'Enter a name.' });
  if (!emailSchema.safeParse(email).success)
    back('/team', { error: 'Enter a valid email address.' });
  if (!(ROLES as readonly string[]).includes(role)) back('/team', { error: 'Choose a role.' });

  try {
    await inviteUser({
      name,
      email,
      role: role as Role,
      brandIds,
      ...(hqRole ? { productRoles: { HQ: hqRole } } : {}),
    });
  } catch (error) {
    back('/team', { error: message(error) });
  }
  back('/team', { saved: `Invitation sent to ${email}.` });
}

export async function productRoleAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const product = formData.get('product');
  const role = String(formData.get('role') ?? '');
  const path = `/team/${id}`;
  if (!isProduct(product)) back(path, { error: 'Unknown product.' });

  try {
    await updateProductRole(id, product as Product, role || null);
  } catch (error) {
    back(path, { error: message(error) });
  }
  back(path, { saved: 'Access updated.' });
}

export async function brandsAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const path = `/team/${id}`;
  try {
    await updateUserBrands(id, formData.getAll('brandIds').map(String));
  } catch (error) {
    back(path, { error: message(error) });
  }
  back(path, { saved: 'Brands updated.' });
}

export async function locationsAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const path = `/team/${id}`;
  try {
    await updateUserLocations(id, formData.getAll('locationIds').map(String));
  } catch (error) {
    back(path, { error: message(error) });
  }
  back(path, { saved: 'Locations updated.' });
}

export async function statusAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const status = formData.get('status') === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  const path = `/team/${id}`;
  try {
    await updateUserStatus(id, status);
  } catch (error) {
    back(path, { error: message(error) });
  }
  back(path, { saved: status === 'SUSPENDED' ? 'Account suspended.' : 'Account reactivated.' });
}
