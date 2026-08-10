'use client';

import { forwardRef, useActionState, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { COUNTRIES, regionsFor } from '@fenwick/shared';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import type { Customer } from '@/lib/api';
import { createCustomerAction, type CreateCustomerState } from './actions';

const initialState: CreateCustomerState = {};

const inputClass =
  'w-full h-10 rounded-lg border bg-white px-4 text-base text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors disabled:bg-slate-50 disabled:text-slate-400';
const validBorder = 'border-[#D4D4D4] focus:border-slate-900 focus-visible:ring-slate-900';
const invalidBorder = 'border-red-400 focus:border-red-500 focus-visible:ring-red-500';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\-.\s\d]*$/;

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  billingLine1?: string;
  billingCity?: string;
  billingRegion?: string;
  billingPostalCode?: string;
  shippingLine1?: string;
  shippingCity?: string;
  shippingRegion?: string;
  shippingPostalCode?: string;
}

const Field = forwardRef<
  HTMLInputElement,
  { label: string; name: string; error?: string } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'name' | 'className'
  >
>(function Field({ label, name, error, ...rest }, ref) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        ref={ref}
        name={name}
        aria-invalid={Boolean(error)}
        className={`${inputClass} ${error ? invalidBorder : validBorder}`}
        {...rest}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </label>
  );
});

function AddressFields({
  prefix,
  country,
  onCountryChange,
  errors,
}: {
  prefix: 'billing' | 'shipping';
  country: string;
  onCountryChange: (code: string) => void;
  errors: FieldErrors;
}) {
  const regions = regionsFor(country);
  const line1Error = errors[`${prefix}Line1` as const];
  const cityError = errors[`${prefix}City` as const];
  const regionError = errors[`${prefix}Region` as const];
  const postalError = errors[`${prefix}PostalCode` as const];

  return (
    <div className="space-y-4">
      <input
        name={`${prefix}Line1`}
        placeholder="Address line 1"
        aria-invalid={Boolean(line1Error)}
        className={`${inputClass} ${line1Error ? invalidBorder : validBorder}`}
      />
      {line1Error && (
        <p role="alert" className="-mt-2.5 text-sm text-red-600">
          {line1Error}
        </p>
      )}

      <input
        name={`${prefix}Line2`}
        placeholder="Address line 2 (optional)"
        className={`${inputClass} ${validBorder}`}
      />

      <div className="grid grid-cols-3 gap-4">
        <input
          name={`${prefix}City`}
          placeholder="City"
          aria-invalid={Boolean(cityError)}
          className={`${inputClass} ${cityError ? invalidBorder : validBorder}`}
        />
        {regions ? (
          <Select
            name={`${prefix}Region`}
            defaultValue=""
            placeholder="State/Province"
            error={regionError}
          >
            {regions.map((region) => (
              <option key={region.code} value={region.code}>
                {region.name}
              </option>
            ))}
          </Select>
        ) : (
          <input
            name={`${prefix}Region`}
            placeholder="State/Province"
            aria-invalid={Boolean(regionError)}
            className={`${inputClass} ${regionError ? invalidBorder : validBorder}`}
          />
        )}
        <input
          name={`${prefix}PostalCode`}
          placeholder="Zip/Postal code"
          aria-invalid={Boolean(postalError)}
          className={`${inputClass} ${postalError ? invalidBorder : validBorder}`}
        />
      </div>
      {(cityError || regionError || postalError) && (
        <p role="alert" className="-mt-2.5 text-sm text-red-600">
          {[cityError, regionError, postalError].filter(Boolean).join(' ')}
        </p>
      )}

      <Select name={`${prefix}Country`} value={country} onChange={onCountryChange}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The Customers listing's "Add Customer" modal. Stays mounted while closed
 * (returns null, but keeps its useActionState instance) for the same reason
 * AddBrandModal does — losing that instance on every close would drop the
 * last submission's state right when a retry needs it.
 */
export function AddCustomerModal({
  open,
  brandId,
  onClose,
  onCreated,
}: {
  open: boolean;
  brandId: string;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}) {
  const action = createCustomerAction.bind(null, brandId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [customerType, setCustomerType] = useState<'BUSINESS' | 'INDIVIDUAL'>('BUSINESS');
  const [billingCountry, setBillingCountry] = useState('US');
  const [shippingCountry, setShippingCountry] = useState('US');
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!state.customer) return;
    onCreated(state.customer);
    formRef.current?.reset();
    setCustomerType('BUSINESS');
    setBillingCountry('US');
    setShippingCountry('US');
    setSameAsBilling(true);
    setFieldErrors({});
    // Only re-run when a fresh customer actually arrives — onCreated is a new
    // function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.customer]);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    formRef.current?.reset();
    setFieldErrors({});
  }, [open]);

  if (!open) return null;

  function validate(formData: FormData): FieldErrors {
    const errors: FieldErrors = {};
    const get = (key: string) => String(formData.get(key) ?? '').trim();

    if (customerType === 'BUSINESS') {
      if (!get('companyName')) errors.name = 'Company name is required.';
    } else if (!get('firstName') && !get('lastName')) {
      errors.name = 'First or last name is required.';
    }

    const email = get('email');
    if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';

    const phone = get('phone');
    if (phone && !PHONE_PATTERN.test(phone)) {
      errors.phone = 'Phone may contain digits and + ( ) - . only.';
    }

    if (!get('billingLine1')) errors.billingLine1 = 'Address line 1 is required.';
    if (!get('billingCity')) errors.billingCity = 'City is required.';
    if (!get('billingRegion')) errors.billingRegion = 'State/Province is required.';
    if (!get('billingPostalCode')) errors.billingPostalCode = 'Zip/Postal code is required.';

    if (!sameAsBilling) {
      if (!get('shippingLine1')) errors.shippingLine1 = 'Address line 1 is required.';
      if (!get('shippingCity')) errors.shippingCity = 'City is required.';
      if (!get('shippingRegion')) errors.shippingRegion = 'State/Province is required.';
      if (!get('shippingPostalCode')) errors.shippingPostalCode = 'Zip/Postal code is required.';
    }

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-customer-heading"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="add-customer-heading" className="text-xl font-bold text-[#0F172A]">
            Add Customer
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#64748B] hover:bg-slate-100 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
          <input type="hidden" name="sameAsBilling" value={sameAsBilling ? 'on' : ''} />

          <div>
            <span className={labelClass}>Business Type</span>
            <div className="flex items-center gap-6" role="radiogroup" aria-label="Business type">
              <label className="flex items-center gap-2 text-sm text-[#0F172A]">
                <input
                  type="radio"
                  name="type"
                  value="BUSINESS"
                  checked={customerType === 'BUSINESS'}
                  onChange={() => setCustomerType('BUSINESS')}
                  className="h-4 w-4 accent-black"
                />
                Company
              </label>
              <label className="flex items-center gap-2 text-sm text-[#0F172A]">
                <input
                  type="radio"
                  name="type"
                  value="INDIVIDUAL"
                  checked={customerType === 'INDIVIDUAL'}
                  onChange={() => setCustomerType('INDIVIDUAL')}
                  className="h-4 w-4 accent-black"
                />
                Individual
              </label>
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-base font-bold text-[#0F172A]">Basic Information</h3>
            <div className="space-y-4">
              {customerType === 'BUSINESS' ? (
                <Field
                  ref={firstFieldRef}
                  label="Company Name"
                  name="companyName"
                  placeholder="Enter your company name"
                  error={fieldErrors.name}
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    ref={firstFieldRef}
                    label="First Name"
                    name="firstName"
                    placeholder="Enter first name"
                    error={fieldErrors.name}
                  />
                  <Field label="Last Name" name="lastName" placeholder="Enter last name" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Email Address"
                  name="email"
                  type="email"
                  placeholder={
                    customerType === 'BUSINESS' ? 'Enter company email address' : 'Enter email address'
                  }
                  error={fieldErrors.email}
                />
                <Field
                  label="Contact Number"
                  name="phone"
                  type="tel"
                  placeholder="Enter contact number"
                  error={fieldErrors.phone}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-base font-bold text-[#0F172A]">Billing Information</h3>
            <span className={labelClass}>Billing Address</span>
            <AddressFields
              prefix="billing"
              country={billingCountry}
              onCountryChange={setBillingCountry}
              errors={fieldErrors}
            />
          </div>

          <div>
            <h3 className="mb-3 text-base font-bold text-[#0F172A]">Shipping Address</h3>
            <Toggle
              id="same-as-billing"
              checked={sameAsBilling}
              onChange={setSameAsBilling}
              label="Same as billing address"
            />
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                sameAsBilling ? 'grid-rows-[0fr]' : 'mt-4 grid-rows-[1fr]'
              }`}
            >
              <div className="overflow-hidden">
                <fieldset disabled={sameAsBilling}>
                  <AddressFields
                    prefix="shipping"
                    country={shippingCountry}
                    onCountryChange={setShippingCountry}
                    errors={fieldErrors}
                  />
                </fieldset>
              </div>
            </div>
          </div>

          {state.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-[#E5E7EB] pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#0F172A] bg-white px-5 py-2.5 text-sm font-bold text-[#0F172A]
                         transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-slate-900 focus-visible:ring-offset-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white transition-colors
                         hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                         disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-black focus-visible:ring-offset-1"
            >
              {pending ? 'Adding…' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
