'use server';

import { redirect } from 'next/navigation';
import { logout } from '@/lib/api';
import { clearSessionToken, LOGIN_PATH } from '@/lib/session';

/**
 * FR-AUTH-010: the session is terminated server-side, not merely forgotten by
 * the browser. The cookie is cleared either way — if the API call fails, the
 * session will still expire on its own, and leaving the user apparently signed
 * in because the sign-out request did not land is the worse outcome.
 */
export async function logoutAction(): Promise<void> {
  try {
    await logout();
  } catch {
    // Already-invalid session, or the API is unreachable. Clear locally regardless.
  }

  await clearSessionToken();
  redirect(LOGIN_PATH);
}
