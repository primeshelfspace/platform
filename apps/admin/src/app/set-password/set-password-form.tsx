'use client';

import { useActionState, useId, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { setPasswordAction, type SetPasswordState } from './actions';

const initialState: SetPasswordState = {};

const MIN_LENGTH = 12;

const inputClass =
  'w-full rounded-[10px] border bg-white px-4 py-3.5 pr-12 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';
const validBorder = 'border-[#D1D5DB] focus:border-slate-900 focus-visible:ring-slate-900';
const invalidBorder = 'border-red-400 focus:border-red-500 focus-visible:ring-red-500';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

interface FieldErrors {
  newPassword?: string;
  confirmPassword?: string;
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  error,
  errorId,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  errorId: string;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block" htmlFor={id}>
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`${inputClass} ${error ? invalidBorder : validBorder}`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#64748B]
                     hover:text-[#0F172A] focus-visible:outline-none"
        >
          {visible ? (
            <EyeOff className="h-5 w-5" aria-hidden />
          ) : (
            <Eye className="h-5 w-5" aria-hidden />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}

export function SetPasswordForm({
  returnTo,
  token,
}: {
  returnTo: string;
  /** Present when arriving from an emailed link; absent for a signed-in user
   * changing their own password. The action branches on it. */
  token?: string;
}) {
  const [state, formAction, pending] = useActionState(setPasswordAction, initialState);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const fieldErrors = useMemo<FieldErrors>(() => {
    if (!touched) return {};
    const errors: FieldErrors = {};
    if (!newPassword) errors.newPassword = 'New password is required.';
    else if (newPassword.length < MIN_LENGTH) {
      errors.newPassword = `Use at least ${MIN_LENGTH} characters.`;
    }
    if (!confirmPassword) errors.confirmPassword = 'Confirm your new password.';
    else if (confirmPassword !== newPassword) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }, [touched, newPassword, confirmPassword]);

  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const newPasswordErrorId = useId();
  const confirmPasswordErrorId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    setTouched(true);
    if (
      !newPassword ||
      newPassword.length < MIN_LENGTH ||
      !confirmPassword ||
      confirmPassword !== newPassword
    ) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-5">
      <input type="hidden" name="next" value={returnTo} />
      {token && <input type="hidden" name="token" value={token} />}

      <PasswordField
        id={newPasswordId}
        name="newPassword"
        label="New Password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
        error={fieldErrors.newPassword}
        errorId={newPasswordErrorId}
        placeholder="Enter new password"
      />

      <PasswordField
        id={confirmPasswordId}
        name="confirmPassword"
        label="Confirm New Password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        error={fieldErrors.confirmPassword}
        errorId={confirmPasswordErrorId}
        placeholder="Repeat new password"
      />

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
        {pending ? 'Setting password…' : 'Set Password'}
      </button>
    </form>
  );
}
