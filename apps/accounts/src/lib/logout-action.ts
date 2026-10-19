'use server';

import { redirect } from 'next/navigation';
import { logout } from './api';
import { clearSessionToken, LOGIN_PATH } from './session';

/**
 * Ends the session on the API and clears the shared cookie — which signs the
 * user out of every product at once. The cookie is cleared even if the API
 * call fails; the session then expires on its own.
 */
export async function logoutAction(): Promise<void> {
  try {
    await logout();
  } catch {
    // Already invalid, or the API is unreachable. Clear locally regardless.
  }
  await clearSessionToken();
  redirect(LOGIN_PATH);
}
