'use client';

import { useActionState, useId, useState } from 'react';
import { emailSchema } from '@fenwick/shared';
import {
  FIELD_INVALID_BORDER as invalidBorder,
  FIELD_VALID_BORDER_SECONDARY as validBorder,
} from '@/components/ui/form-styles';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

const inputClass =
  'w-full rounded-[10px] border bg-white px-4 py-3.5 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const emailId = useId();
  const passwordId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();

  function validate(formData: FormData): FieldErrors {
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const errors: FieldErrors = {};

    if (!email) errors.email = 'Email address is required.';
    else if (!emailSchema.safeParse(email).success) errors.email = 'Enter a valid email address.';

    if (!password) errors.password = 'Password is required.';

    return errors;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const errors = validate(new FormData(event.currentTarget));
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-5">
      <input type="hidden" name="next" value={returnTo} />

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
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          className={`${inputClass} ${fieldErrors.email ? invalidBorder : validBorder}`}
          placeholder="Enter email address"
        />
        {fieldErrors.email && (
          <p id={emailErrorId} role="alert" className="mt-1.5 text-sm text-red-600">
            {fieldErrors.email}
          </p>
        )}
      </label>

      <label className="block" htmlFor={passwordId}>
        <span className={labelClass}>Password</span>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
          className={`${inputClass} ${fieldErrors.password ? invalidBorder : validBorder}`}
          placeholder="Enter password"
        />
        {fieldErrors.password && (
          <p id={passwordErrorId} role="alert" className="mt-1.5 text-sm text-red-600">
            {fieldErrors.password}
          </p>
        )}
      </label>

      <div className="flex items-start gap-2.5 rounded-[10px] bg-[#E8EFFE] px-4 py-3.5">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="mt-0.5 h-5 w-5 shrink-0 text-[#3B5BDB]"
          aria-hidden
        >
          <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="6.5" r="0.9" fill="currentColor" />
        </svg>
        <p className="text-sm text-[#3B5BDB]">
          You&rsquo;ll be required to reset your password after logging in.
        </p>
      </div>

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
        {pending ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  );
}
