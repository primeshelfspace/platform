'use server';

import { redirect } from 'next/navigation';
import { emailSchema } from '@fenwick/shared';
import { requestPasswordReset } from '@/lib/api';

export interface ForgotPasswordState {
  readonly error?: string;
  /** Kept so the field is not cleared under the user when the attempt fails. */
  readonly email?: string;
}

/**
 * FR-AUTH-005. The API acknowledges identically whether or not the address
 * matches an account, and whether or not the caller has already hit the rate
 * limit (see AuthService.requestPasswordReset) — so a request that reaches
 * the server always lands on /check-inbox. There is nothing here to branch on
 * beyond "did the request even reach the API."
 */
export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim();

  if (!email) return { error: 'Enter your email address.', email };
  // The form validates this too, but a request can always arrive without
  // having run that JS — the server is the check that actually holds.
  if (!emailSchema.safeParse(email).success) {
    return { error: 'Enter a valid email address.', email };
  }

  try {
    await requestPasswordReset(email);
  } catch {
    // Whatever went wrong, it is not something to reveal about the address —
    // only that the service itself could not be reached.
    return { error: 'Could not reach the server. Try again.', email };
  }

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful request into an error message.
  redirect(`/check-inbox?email=${encodeURIComponent(email)}`);
}
