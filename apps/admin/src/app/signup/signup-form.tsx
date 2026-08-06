'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { signupAction, type SignupState } from './actions';

const initialState: SignupState = {};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full rounded-[10px] border bg-white px-4 py-3.5 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';
const validBorder = 'border-[#D1D5DB] focus:border-slate-900 focus-visible:ring-slate-900';
const invalidBorder = 'border-red-400 focus:border-red-500 focus-visible:ring-red-500';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

interface FieldErrors {
  fullName?: string;
  email?: string;
}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const nameId = useId();
  const emailId = useId();
  const nameErrorId = useId();
  const emailErrorId = useId();

  function validate(formData: FormData): FieldErrors {
    const fullName = String(formData.get('fullName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const errors: FieldErrors = {};

    if (!fullName) errors.fullName = 'Full name is required.';

    if (!email) errors.email = 'Email address is required.';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';

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
      <label className="block" htmlFor={nameId}>
        <span className={labelClass}>Full Name</span>
        <input
          id={nameId}
          name="fullName"
          type="text"
          autoComplete="name"
          autoFocus
          required
          defaultValue={state.fullName ?? ''}
          aria-invalid={Boolean(fieldErrors.fullName)}
          aria-describedby={fieldErrors.fullName ? nameErrorId : undefined}
          className={`${inputClass} ${fieldErrors.fullName ? invalidBorder : validBorder}`}
          placeholder="Enter your full name"
        />
        {fieldErrors.fullName && (
          <p id={nameErrorId} role="alert" className="mt-1.5 text-sm text-red-600">
            {fieldErrors.fullName}
          </p>
        )}
      </label>

      <label className="block" htmlFor={emailId}>
        <span className={labelClass}>Email Address</span>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
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
        {pending ? 'Creating your account…' : 'Create Account'}
      </button>

      <p className="text-center text-sm text-[#64748B]">
        By creating an account, you agree to our{' '}
        <Link href="/terms" className="font-medium text-[#0F172A] underline">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="font-medium text-[#0F172A] underline">
          conditions
        </Link>
        .
      </p>
    </form>
  );
}
