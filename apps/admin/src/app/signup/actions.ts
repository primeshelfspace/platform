'use server';

import { redirect } from 'next/navigation';
import { ApiError, register } from '@/lib/api';

export interface SignupState {
  readonly error?: string;
  /** Kept so the fields are not cleared under the user when the attempt fails. */
  readonly fullName?: string;
  readonly email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FR-ONB step 0. Creates the tenant and its owner, then signs them in.
 *
 * There is no password field and no session: the API emails a set-password
 * link, and proving control of that address is what turns the account into a
 * usable one. Following the link lands on /set-password, and from there the
 * existing onboarding chain takes over — company details, brand structure,
 * dashboard.
 */
export async function signupAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();

  if (!fullName) return { error: 'Enter your full name.', fullName, email };
  // The form validates this too, but a request can always arrive without
  // having run that JS — the server is the check that actually holds.
  if (!EMAIL_PATTERN.test(email)) {
    return { error: 'Enter a valid email address.', fullName, email };
  }

  try {
    await register(fullName, email);
  } catch (error) {
    if (error instanceof ApiError) {
      // 409 is the one failure worth naming: the address is already taken, and
      // the useful next step is signing in rather than trying again.
      if (error.status === 409) {
        return {
          error: 'An account with this email already exists. Sign in instead.',
          fullName,
          email,
        };
      }
      return { error: error.message, fullName, email };
    }
    return { error: 'Could not reach the sign-up service.', fullName, email };
  }

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful sign-up into an error message.
  // The address travels along only so the next screen can say which inbox to
  // check; nothing is decided from it.
  redirect(`/check-inbox?email=${encodeURIComponent(email)}`);
}
