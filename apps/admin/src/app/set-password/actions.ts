'use server';

import { redirect } from 'next/navigation';
import { setPasswordSchema } from '@fenwick/shared';
import { ApiError, getCurrentUser, setPassword, setPasswordWithToken } from '@/lib/api';
import { resolveOnboardingStep, routeForStep } from '@/lib/onboarding';
import { safeReturnPath, writeSessionToken } from '@/lib/session';

export interface SetPasswordState {
  readonly error?: string;
}

const MISMATCH = 'New password and confirmation do not match.';

export async function setPasswordAction(
  _prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const returnTo = safeReturnPath(String(formData.get('next') ?? ''));

  if (newPassword !== confirmPassword) {
    return { error: MISMATCH };
  }

  // The form validates this too, but a request can always arrive without
  // having run that JS — the server is the check that actually holds.
  const parsed = setPasswordSchema.safeParse({ newPassword });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid password.' };
  }

  // Two ways to reach this screen, and they authenticate differently: an
  // emailed link carries a one-time token and no session, while a signed-in
  // user carries a session and no token. The token path also mints the session
  // that the rest of onboarding then runs on.
  const token = String(formData.get('token') ?? '');

  try {
    if (token) {
      const result = await setPasswordWithToken(token, newPassword);
      await writeSessionToken(result.token, new Date(result.expiresAt));
    } else {
      await setPassword(newPassword);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (token && error.status === 401) {
        return {
          error: 'This link has expired or has already been used. Request a new one.',
        };
      }
      return { error: error.status === 401 ? 'Your session ended. Sign in again.' : error.message };
    }
    return { error: 'Could not reach the server. Try again.' };
  }

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful change into an error message.
  // mustResetPassword is now false, so resolveOnboardingStep either sends
  // this user on to whatever onboarding they still owe, or (an already-
  // onboarded user changing their password voluntarily) returns null and
  // this falls through to wherever they actually meant to go.
  const user = await getCurrentUser();
  const step = await resolveOnboardingStep(user);
  if (step) {
    redirect(routeForStep(step));
  }
  redirect(returnTo);
}
