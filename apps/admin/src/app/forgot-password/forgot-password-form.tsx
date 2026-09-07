'use client';

import { useActionState, useId, useState } from 'react';
import { emailSchema } from '@fenwick/shared';
import {
  FIELD_INVALID_BORDER as invalidBorder,
  FIELD_VALID_BORDER_SECONDARY as validBorder,
} from '@/components/ui/form-styles';
import { forgotPasswordAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = {};

const inputClass =
  'w-full rounded-[10px] border bg-white px-4 py-3.5 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const [emailError, setEmailError] = useState<string | undefined>();
  const emailId = useId();
  const emailErrorId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    let error: string | undefined;
    if (!email) error = 'Email address is required.';
    else if (!emailSchema.safeParse(email).success) error = 'Enter a valid email address.';

    setEmailError(error);
    if (error) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-5">
      <label className="block" htmlFor={emailId}>
        <span className={labelClass}>Email Address</span>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          defaultValue={state.email ?? ''}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? emailErrorId : undefined}
          className={`${inputClass} ${emailError ? invalidBorder : validBorder}`}
          placeholder="Enter email address"
        />
        {emailError && (
          <p id={emailErrorId} role="alert" className="mt-1.5 text-sm text-red-600">
            {emailError}
          </p>
        )}
      </label>

      {state.error && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[10px] bg-black px-4 py-3.5 text-base font-bold text-white
                   transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                   disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-black focus-visible:ring-offset-2"
      >
        {pending ? 'Sending…' : 'Send Reset Link'}
      </button>
    </form>
  );
}
