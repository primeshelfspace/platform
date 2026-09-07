'use client';

import { forwardRef, useActionState, useEffect, useRef, useState } from 'react';
import { COUNTRIES, emailSchema, phoneSchema, regionsFor } from '@fenwick/shared';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Modal } from '@/components/ui/modal';
import {
  FIELD_INVALID_BORDER as invalidBorder,
  FIELD_VALID_BORDER_PRIMARY as validBorder,
  VALIDATED_FIELD_INPUT_CLASS as inputClass,
  VALIDATED_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import type { Customer, CustomerAddress } from '@/lib/api';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import { updateCustomerAction, type UpdateCustomerState } from './actions';

const initialState: UpdateCustomerState = {};

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
  address,
  country,
  onCountryChange,
  errors,
}: {
  prefix: 'billing' | 'shipping';
  address: CustomerAddress | null;
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
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <input
          name={`${prefix}Line1`}
          defaultValue={address?.line1 ?? ''}
          placeholder="Address line 1"
          aria-invalid={Boolean(line1Error)}
          className={`${inputClass} ${line1Error ? invalidBorder : validBorder}`}
        />
        <input
          name={`${prefix}Line2`}
          defaultValue={address?.line2 ?? ''}
          placeholder="Address line 2 (optional)"
          className={`${inputClass} ${validBorder}`}
        />
      </div>
      {line1Error && (
        <p role="alert" className="-mt-1 text-sm text-red-600">
          {line1Error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-4">
        <input
          name={`${prefix}City`}
          defaultValue={address?.city ?? ''}
          placeholder="City"
          aria-invalid={Boolean(cityError)}
          className={`${inputClass} ${cityError ? invalidBorder : validBorder}`}
        />
        {regions ? (
          <Select
            name={`${prefix}Region`}
            defaultValue={address?.region ?? ''}
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
            defaultValue={address?.region ?? ''}
            placeholder="State/Province"
            aria-invalid={Boolean(regionError)}
            className={`${inputClass} ${regionError ? invalidBorder : validBorder}`}
          />
        )}
        <input
          name={`${prefix}PostalCode`}
          defaultValue={address?.postalCode ?? ''}
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

/** True when b and s are the same address field-for-field (null counts as
 * equal to an all-null/empty address) — used only to decide whether the
 * modal opens with "Same as billing address" pre-checked; not a comparison
 * either the form or the API relies on. */
function addressesMatch(b: CustomerAddress | null, s: CustomerAddress | null): boolean {
  if (!s) return true;
  if (!b) return false;
  return (
    (b.line1 ?? '') === (s.line1 ?? '') &&
    (b.line2 ?? '') === (s.line2 ?? '') &&
    (b.city ?? '') === (s.city ?? '') &&
    (b.region ?? '') === (s.region ?? '') &&
    (b.postalCode ?? '') === (s.postalCode ?? '') &&
    (b.country ?? '') === (s.country ?? '')
  );
}

/**
 * The Customer detail drawer's "Edit Details" modal — a sibling of
 * AddCustomerModal, same fields and layout, prefilled from the customer
 * being edited instead of starting blank. Kept as its own component rather
 * than a create/edit mode toggle on AddCustomerModal for the same
 * independently-safe-to-change reasoning this app's other paired
 * create/edit forms already follow.
 */
export function EditCustomerModal({
  open,
  brandId,
  customer,
  onClose,
  onUpdated,
}: {
  open: boolean;
  brandId: string;
  customer: Customer;
  onClose: () => void;
  onUpdated: (customer: Customer) => void;
}) {
  const action = updateCustomerAction.bind(null, brandId, customer.id);
  const [state, formAction, pending] = useActionState(action, initialState);
  useFormStatusToast(state);
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [customerType, setCustomerType] = useState<'BUSINESS' | 'INDIVIDUAL'>(customer.type);
  const [billingCountry, setBillingCountry] = useState(customer.billingAddress?.country ?? 'US');
  const [shippingCountry, setShippingCountry] = useState(
    customer.shippingAddress?.country ?? customer.billingAddress?.country ?? 'US',
  );
  const [sameAsBilling, setSameAsBilling] = useState(
    addressesMatch(customer.billingAddress, customer.shippingAddress),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!state.customer) return;
    onUpdated(state.customer);
    // Intentionally keyed on `state` alone: this should fire once per
    // successful save, not re-run on every subsequent keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.customer]);

  // Re-seed every field from whichever customer this modal was opened for —
  // covers both a fresh open and switching straight from editing one
  // customer to another without this component unmounting in between.
  useEffect(() => {
    if (!open) return;
    setCustomerType(customer.type);
    setBillingCountry(customer.billingAddress?.country ?? 'US');
    setShippingCountry(
      customer.shippingAddress?.country ?? customer.billingAddress?.country ?? 'US',
    );
    setSameAsBilling(addressesMatch(customer.billingAddress, customer.shippingAddress));
    setFieldErrors({});
    firstFieldRef.current?.focus();
    // Only re-seed when the modal opens or which customer it targets changes
    // — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer.id]);

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
    if (email && !emailSchema.safeParse(email).success)
      errors.email = 'Enter a valid email address.';

    const phone = get('phone');
    if (phone && !phoneSchema.safeParse(phone).success) {
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
    <Modal
      open={open}
      onClose={onClose}
      titleId="edit-customer-heading"
      title="Edit Customer"
      dialogClassName="max-h-[96vh] w-full max-w-[520px] overflow-y-auto"
    >
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="sameAsBilling" value={sameAsBilling ? 'on' : ''} />
        <input type="hidden" name="salutation" value={customer.salutation ?? ''} />

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
          <h3 className="mb-2 text-base font-bold text-[#0F172A]">Basic Information</h3>
          <div className="space-y-2">
            {customerType === 'BUSINESS' ? (
              <Field
                ref={firstFieldRef}
                label="Company Name"
                name="companyName"
                defaultValue={customer.companyName ?? ''}
                placeholder="Enter your company name"
                error={fieldErrors.name}
              />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field
                  ref={firstFieldRef}
                  label="First Name"
                  name="firstName"
                  defaultValue={customer.firstName ?? ''}
                  placeholder="Enter first name"
                  error={fieldErrors.name}
                />
                <Field
                  label="Last Name"
                  name="lastName"
                  defaultValue={customer.lastName ?? ''}
                  placeholder="Enter last name"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Email Address"
                name="email"
                type="email"
                defaultValue={customer.email ?? ''}
                placeholder={
                  customerType === 'BUSINESS'
                    ? 'Enter company email address'
                    : 'Enter email address'
                }
                error={fieldErrors.email}
              />
              <Field
                label="Contact Number"
                name="phone"
                type="tel"
                defaultValue={customer.phone ?? ''}
                placeholder="Enter contact number"
                error={fieldErrors.phone}
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-base font-bold text-[#0F172A]">Billing Information</h3>
          <span className={labelClass}>Billing Address</span>
          <AddressFields
            prefix="billing"
            address={customer.billingAddress}
            country={billingCountry}
            onCountryChange={setBillingCountry}
            errors={fieldErrors}
          />
        </div>

        <div>
          <h3 className="mb-2 text-base font-bold text-[#0F172A]">Shipping Address</h3>
          <Toggle
            id="edit-same-as-billing"
            checked={sameAsBilling}
            onChange={setSameAsBilling}
            label="Same as billing address"
          />
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              sameAsBilling ? 'grid-rows-[0fr]' : 'mt-3 grid-rows-[1fr]'
            }`}
          >
            <div className="overflow-hidden">
              <fieldset disabled={sameAsBilling}>
                <AddressFields
                  prefix="shipping"
                  address={customer.shippingAddress}
                  country={shippingCountry}
                  onCountryChange={setShippingCountry}
                  errors={fieldErrors}
                />
              </fieldset>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#E5E7EB] pt-3">
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
            {pending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
