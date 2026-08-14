'use server';

import { redirect } from 'next/navigation';
import { emailSchema } from '@fenwick/shared';
import { ApiError, login } from '@/lib/api';
import { resolveOnboardingStep, routeForStep } from '@/lib/onboarding';
import { safeReturnPath, writeSessionToken } from '@/lib/session';

export interface LoginState {
  readonly error?: string;
  /** Kept so the field is not cleared under the user when the attempt fails. */
  readonly email?: string;
}

/**
 * FR-AUTH-003: the API answers every failure identically, and so does this. The
 * only messages that differ are the ones that are not about credentials at all —
 * an empty field, or the API being unreachable.
 */
const GENERIC_FAILURE = 'That email and password combination was not recognised.';

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const returnTo = safeReturnPath(String(formData.get('next') ?? ''));

  if (!email || !password) {
    return { error: 'Enter your email address and password.', email };
  }
  // The form validates this too, but a request can always arrive without
  // having run that JS — the server is the check that actually holds.
  if (!emailSchema.safeParse(email).success) {
    return { error: 'Enter a valid email address.', email };
  }

  let result;
  try {
    result = await login(email, password);
  } catch (error) {
    if (error instanceof ApiError) {
      // 401 is a rejected credential; 400 is a malformed address, which is still
      // not worth distinguishing to whoever is typing. Anything else is ours.
      if (error.status === 401 || error.status === 400) return { error: GENERIC_FAILURE, email };
      return { error: `Could not reach the sign-in service (${error.status}).`, email };
    }
    return { error: 'Could not reach the sign-in service.', email };
  }

  await writeSessionToken(result.token, new Date(result.expiresAt));

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful sign-in into an error message.
  // A signed-in user with unfinished onboarding (forced password reset
  // included — resolveOnboardingStep checks that first) goes there instead
  // of wherever they were originally headed; a fully onboarded user gets
  // their original destination back.
  const step = await resolveOnboardingStep(result.user);
  if (step === 'set-password') {
    redirect(`/set-password?next=${encodeURIComponent(returnTo)}`);
  }
  if (step) {
    redirect(routeForStep(step));
  }
  redirect(returnTo);
}
