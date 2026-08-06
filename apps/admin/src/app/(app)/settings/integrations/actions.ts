'use server';

import {
  disconnectZoho,
  updateZohoSyncSettings,
  type ZohoConnectionStatus,
  type ZohoSyncSettingsPatch,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

export type ActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/**
 * Called directly from the client panel's onChange handlers, not bound to a
 * `<form>` — FR-ZHO-030 wants each control to persist itself the moment it
 * changes, and a Server Action is a plain async function whether or not
 * anything ever wires it to `useActionState`.
 */
export async function updateZohoSyncSettingsAction(
  brandId: string,
  patch: ZohoSyncSettingsPatch,
): Promise<ActionResult<ZohoConnectionStatus>> {
  try {
    const status = await updateZohoSyncSettings(brandId, patch);
    return { ok: true, data: status };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not save this setting.') };
  }
}

/** Behind a confirmation dialog in the panel, not a plain click — this ends
 * every push and pull for the brand immediately. */
export async function disconnectZohoAction(brandId: string): Promise<ActionResult<{ ok: true }>> {
  try {
    const result = await disconnectZoho(brandId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not disconnect Zoho Books.') };
  }
}
