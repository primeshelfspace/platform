'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, COUNTRIES, regionsFor } from '@fenwick/shared';
import type { Brand, CustomerAddress } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import {
  COMPACT_FIELD_INPUT_CLASS as inputClass,
  STATIC_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { saveBrandDetailsAction, type BrandDetailsState } from './actions';
import { SaveBar } from './save-bar';

const initialState: BrandDetailsState = {};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml'];

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

function addressEquals(a: CustomerAddress | null, b: CustomerAddress | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.city === b.city &&
    a.region === b.region &&
    a.postalCode === b.postalCode &&
    a.country === b.country
  );
}

interface AddressValues {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

interface BrandDetailsValues {
  legalName: string;
  displayName: string;
  businessType: string;
  email: string;
  phone: string;
  taxId: string;
  mailing: AddressValues;
  billing: AddressValues;
  sameAsMailing: boolean;
}

function addressValuesFrom(
  address: CustomerAddress | null,
  fallbackCountry: string,
): AddressValues {
  return {
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    region: address?.region ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? fallbackCountry,
  };
}

function addressValuesEqual(a: AddressValues, b: AddressValues): boolean {
  return (
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.city === b.city &&
    a.region === b.region &&
    a.postalCode === b.postalCode &&
    a.country === b.country
  );
}

function valuesFromBrand(brand: Brand): BrandDetailsValues {
  const mailing = addressValuesFrom(brand.mailingAddress, 'US');
  return {
    legalName: brand.legalName,
    displayName: brand.displayName,
    businessType: brand.businessType ?? '',
    email: brand.email ?? '',
    phone: brand.phone ?? '',
    taxId: brand.taxId ?? '',
    mailing,
    billing: addressValuesFrom(brand.billingAddress, mailing.country),
    sameAsMailing:
      brand.billingAddress === null || addressEquals(brand.billingAddress, brand.mailingAddress),
  };
}

// Mirrors the server action's own rule (actions.ts): when "same as mailing"
// is on, the billing fields are disabled and the mailing address is what
// actually gets saved as the billing address — so dirty-checking has to
// compare against that effective value, not the (possibly stale, disabled)
// billing fields themselves.
function effectiveBilling(values: BrandDetailsValues): AddressValues {
  return values.sameAsMailing ? values.mailing : values.billing;
}

function valuesEqual(a: BrandDetailsValues, b: BrandDetailsValues): boolean {
  return (
    a.legalName === b.legalName &&
    a.displayName === b.displayName &&
    a.businessType === b.businessType &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.taxId === b.taxId &&
    a.sameAsMailing === b.sameAsMailing &&
    addressValuesEqual(a.mailing, b.mailing) &&
    addressValuesEqual(effectiveBilling(a), effectiveBilling(b))
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  ...rest
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'name' | 'className' | 'value' | 'onChange'
>) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        {...rest}
      />
    </label>
  );
}

/** One address group, written as `${prefix}Line1`, `${prefix}City` and so
 * on — shared between Mailing and Billing, which are otherwise identical. */
function AddressFields({
  prefix,
  value,
  onChange,
  disabled,
}: {
  prefix: 'mailing' | 'billing';
  value: AddressValues;
  onChange: (patch: Partial<AddressValues>) => void;
  disabled?: boolean;
}) {
  const regions = regionsFor(value.country);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name={`${prefix}Line1`}
          placeholder="Address line 1"
          value={value.line1}
          onChange={(event) => onChange({ line1: event.target.value })}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
        <input
          name={`${prefix}Line2`}
          placeholder="Address line 2 (optional)"
          value={value.line2}
          onChange={(event) => onChange({ line2: event.target.value })}
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <input
          name={`${prefix}City`}
          placeholder="City"
          value={value.city}
          onChange={(event) => onChange({ city: event.target.value })}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
        {regions ? (
          <Select
            compact
            name={`${prefix}Region`}
            value={value.region}
            onChange={(region) => onChange({ region })}
            placeholder="State/Province"
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
            value={value.region}
            onChange={(event) => onChange({ region: event.target.value })}
            disabled={disabled}
            className={inputClass}
          />
        )}
        <input
          name={`${prefix}PostalCode`}
          placeholder="Zip/Postal code"
          value={value.postalCode}
          onChange={(event) => onChange({ postalCode: event.target.value })}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
      </div>

      <Select
        compact
        name={`${prefix}Country`}
        value={value.country}
        onChange={(country) => onChange({ country })}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function BrandDetailsForm({ brand }: { brand: Brand }) {
  const action = saveBrandDetailsAction.bind(null, brand);
  const [state, formAction, pending] = useActionState(action, initialState);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | undefined>();
  const [logoDirty, setLogoDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoSrc = logoPreview ?? brand.logoUrl;

  // `savedValues` is the last-known-persisted state (seeded from `brand`,
  // then re-seeded from whatever was just submitted the moment a save
  // succeeds — see the effect below). `values` is the live, editable copy.
  // Comparing the two is what drives the Save/Discard bar, independent of
  // whether/when the server component above re-renders with a fresh `brand`.
  const [savedValues, setSavedValues] = useState(() => valuesFromBrand(brand));
  const [values, setValues] = useState(savedValues);

  const businessTypeId = useId();

  const isDirty = logoDirty || !valuesEqual(values, savedValues);

  function updateMailing(patch: Partial<AddressValues>) {
    setValues((prev) => ({ ...prev, mailing: { ...prev.mailing, ...patch } }));
  }

  function updateBilling(patch: Partial<AddressValues>) {
    setValues((prev) => ({ ...prev, billing: { ...prev.billing, ...patch } }));
  }

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setLogoPreview(null);
      setLogoError(undefined);
      setLogoDirty(false);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoError('Logo must be a JPG, PNG, or SVG image.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Logo must be 5MB or smaller.');
      event.target.value = '';
      return;
    }
    setLogoError(undefined);
    setLogoPreview(URL.createObjectURL(file));
    setLogoDirty(true);
  }

  function handleDiscard() {
    setValues(savedValues);
    setLogoPreview(null);
    setLogoError(undefined);
    setLogoDirty(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // On a successful save, whatever was just submitted becomes the new
  // baseline — this is what makes the buttons disappear rather than relying
  // on the parent server component re-rendering with a fresh `brand` prop
  // (which happens on its own timeline via revalidatePath).
  useEffect(() => {
    if (!state.success) return;
    setSavedValues(values);
    setLogoPreview(null);
    setLogoDirty(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Intentionally keyed on `state` alone: this should fire once per
    // successful dispatch, using whichever `values` were current at that
    // point (submission is blocked mid-flight by the fieldset below), not
    // re-fire on every subsequent keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    // Capped, not full width: a single-column-per-field form stretched across
    // a wide monitor is harder to scan, not easier — same reasoning as
    // PageContainer's own `narrow` variant, which this matches (max-w-2xl).
    //
    // No card: this tab renders directly on the page background, sections
    // separated by plain <hr>s, matching the reference design exactly (the
    // Branding tab's editors keep their own bordered/shadowed card — that's
    // a separate, deliberately different treatment, not a shared convention
    // to mirror here).
    //
    // The Save/Discard bar is a real descendant of the <form>, never a
    // button linked in from outside via `form="id"` — see save-bar.tsx.
    // `<form>` itself is intentionally unconstrained (full main width) —
    // max-w-2xl lives on each *section* instead, so a section's own <hr>
    // sibling resolves its `auto` width against the page's true width
    // rather than being boxed in by a 672px containing block that no
    // negative margin can escape.
    <form action={formAction}>
      <input type="hidden" name="sameAsMailing" value={values.sameAsMailing ? '1' : ''} />

      {/* Locks every field while a save is in flight — belt-and-braces
          alongside the disabled Save button, since disabled form controls
          also can't be edited or re-submitted mid-request. */}
      <fieldset disabled={pending} className="space-y-5">
        <section className="max-w-2xl">
          <h2 className="mb-3 text-base font-bold text-[#0F172A]">General Information</h2>

          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload business logo"
              className="flex h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-full
                       border border-white text-lg font-bold text-white focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
              style={{ backgroundColor: logoSrc ? undefined : brand.themeColor }}
            >
              {logoSrc ? (
                // Local preview or the brand's already-uploaded logo — never invented.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                initialOf(brand.displayName)
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-hidden
              tabIndex={-1}
              className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full
                       border-2 border-white bg-blue-600 text-white shadow-sm"
            >
              <Pencil className="h-2.5 w-2.5" aria-hidden />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              name="logo"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={handleLogoChange}
              className="hidden"
            />
          </div>
          {logoError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {logoError}
            </p>
          )}

          <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field
              label="Legal Business Name"
              name="legalName"
              required
              value={values.legalName}
              onChange={(legalName) => setValues((prev) => ({ ...prev, legalName }))}
              placeholder="Enter legal business name"
            />
            {/* The brand's trading name — what customers see — distinct from the
              legal name above where the two differ. */}
            <Field
              label="DBA (doing business as)"
              name="displayName"
              required
              value={values.displayName}
              onChange={(displayName) => setValues((prev) => ({ ...prev, displayName }))}
              placeholder="Enter DBA"
            />
            <label className="block" htmlFor={businessTypeId}>
              <span className={labelClass}>Business Type</span>
              <Select
                compact
                id={businessTypeId}
                name="businessType"
                required
                value={values.businessType}
                onChange={(businessType) => setValues((prev) => ({ ...prev, businessType }))}
                placeholder="Select type"
              >
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {BUSINESS_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </label>
            <Field
              label="Business Email"
              name="email"
              type="email"
              value={values.email}
              onChange={(email) => setValues((prev) => ({ ...prev, email }))}
              placeholder="Enter business email"
            />
            <Field
              label="Business Phone"
              name="phone"
              type="tel"
              value={values.phone}
              onChange={(phone) => setValues((prev) => ({ ...prev, phone }))}
              placeholder="Enter phone number"
            />
            <Field
              label="Tax ID / EIN"
              name="taxId"
              value={values.taxId}
              onChange={(taxId) => setValues((prev) => ({ ...prev, taxId }))}
              placeholder="Enter Tax ID/EIN"
            />
          </div>
        </section>

        {/* Full-width, not confined to the max-w-2xl field column — runs
            edge-to-edge with the page like it does in the reference
            design. */}
        <hr className="-mx-6 border-t border-[#E5E7EB] sm:-mx-10" />

        <section className="max-w-2xl">
          <h2 className="mb-3 text-base font-bold text-[#0F172A]">Mailing Address</h2>
          <AddressFields prefix="mailing" value={values.mailing} onChange={updateMailing} />
        </section>

        {/* Full-width, not confined to the max-w-2xl field column — runs
            edge-to-edge with the page like it does in the reference
            design. */}
        <hr className="-mx-6 border-t border-[#E5E7EB] sm:-mx-10" />

        <section className="max-w-2xl">
          <h2 className="mb-3 text-base font-bold text-[#0F172A]">Billing Address</h2>
          <Toggle
            id="same-as-mailing"
            checked={values.sameAsMailing}
            onChange={(sameAsMailing) => setValues((prev) => ({ ...prev, sameAsMailing }))}
            label="Same as Mailing address"
          />
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              values.sameAsMailing ? 'grid-rows-[0fr]' : 'mt-5 grid-rows-[1fr]'
            }`}
          >
            <div className="overflow-hidden">
              <fieldset disabled={values.sameAsMailing}>
                <AddressFields
                  prefix="billing"
                  value={values.billing}
                  onChange={updateBilling}
                  disabled={values.sameAsMailing}
                />
              </fieldset>
            </div>
          </div>
        </section>

        {state.error && (
          <p
            role="alert"
            className="max-w-2xl rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {state.error}
          </p>
        )}
        {state.warning && (
          <p
            role="status"
            className="max-w-2xl rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            {state.warning}
          </p>
        )}
        {/* Not shown alongside a warning: the warning text ("saved, but the
            logo did not upload") already says the save itself went through —
            a green "Saved." next to it reads as everything having worked. */}
        {state.success && !state.warning && (
          <p className="max-w-2xl rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Saved.
          </p>
        )}
      </fieldset>
      <SaveBar dirty={isDirty} pending={pending} onDiscard={handleDiscard} />
    </form>
  );
}
