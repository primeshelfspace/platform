'use client';

import { useActionState, useState } from 'react';
import {
  TOKEN_FIELD_INPUT_CLASS as inputClass,
  TOKEN_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { createCustomerAction, type CreateCustomerState } from './actions';

const initialState: CreateCustomerState = {};

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input name={name} className={inputClass} {...rest} />
    </label>
  );
}

function AddressFields({ prefix, disabled }: { prefix: string; disabled?: boolean }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <div className="col-span-2">
        <Field label="Address line 1" name={`${prefix}Line1`} disabled={disabled} />
      </div>
      <div className="col-span-2">
        <Field label="Address line 2" name={`${prefix}Line2`} disabled={disabled} />
      </div>
      <Field label="City" name={`${prefix}City`} disabled={disabled} />
      <Field label="State / region" name={`${prefix}Region`} disabled={disabled} />
      <Field label="Postal code" name={`${prefix}PostalCode`} disabled={disabled} />
      <Field
        label="Country (2-letter, e.g. US)"
        name={`${prefix}Country`}
        maxLength={2}
        disabled={disabled}
      />
    </div>
  );
}

export function CustomerForm({ brandId }: { brandId: string }) {
  const [state, formAction, pending] = useActionState(createCustomerAction, initialState);
  const [type, setType] = useState<'BUSINESS' | 'INDIVIDUAL'>('BUSINESS');
  const [sameAsBilling, setSameAsBilling] = useState(true);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="brandId" value={brandId} />

      <fieldset className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-1 text-sm font-medium text-ink-strong">Customer type</legend>
        <div className="mt-3 flex gap-4">
          {(['BUSINESS', 'INDIVIDUAL'] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink-strong">
              <input
                type="radio"
                name="type"
                value={option}
                checked={type === option}
                onChange={() => setType(option)}
              />
              {option === 'BUSINESS' ? 'Business' : 'Individual'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-1 text-sm font-medium text-ink-strong">Identity</legend>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {type === 'BUSINESS' ? (
            <div className="col-span-2">
              <Field label="Company name" name="companyName" required />
            </div>
          ) : (
            <>
              <Field label="Salutation (optional)" name="salutation" />
              <div />
              <Field label="First name" name="firstName" />
              <Field label="Last name" name="lastName" />
            </>
          )}
          <div className="col-span-2">
            <Field
              label="Display name (optional — defaults from the name above)"
              name="displayName"
            />
          </div>
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" type="tel" />
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-1 text-sm font-medium text-ink-strong">Billing address</legend>
        <div className="mt-3">
          <AddressFields prefix="billing" />
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-1 text-sm font-medium text-ink-strong">Shipping address</legend>
        <label className="mt-3 mb-3 flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            name="sameAsBilling"
            checked={sameAsBilling}
            onChange={(e) => setSameAsBilling(e.target.checked)}
          />
          Same as billing address
        </label>
        <AddressFields prefix="shipping" disabled={sameAsBilling} />
      </fieldset>

      {state.error && (
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">{state.error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Add customer'}
        </button>
        <a href={`/customers?brandId=${brandId}`} className="text-sm text-ink-muted">
          Cancel
        </a>
      </div>
    </form>
  );
}
