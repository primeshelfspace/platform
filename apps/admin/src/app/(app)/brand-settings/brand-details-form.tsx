'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, COUNTRIES, regionsFor } from '@fenwick/shared';
import type { Brand, CustomerAddress } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import {
  STATIC_FIELD_INPUT_CLASS as inputClass,
  STATIC_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { saveBrandDetailsAction, type BrandDetailsState } from './actions';

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

function Field({
  label,
  name,
  defaultValue,
  ...rest
}: { label: string; name: string; defaultValue?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'name' | 'className' | 'defaultValue'
>) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input name={name} defaultValue={defaultValue} className={inputClass} {...rest} />
    </label>
  );
}

/** One address group, written as `${prefix}Line1`, `${prefix}City` and so
 * on — shared between Mailing and Billing, which are otherwise identical. */
function AddressFields({
  prefix,
  country,
  onCountryChange,
  disabled,
  defaults,
}: {
  prefix: 'mailing' | 'billing';
  country: string;
  onCountryChange: (code: string) => void;
  disabled?: boolean;
  defaults: CustomerAddress | null;
}) {
  const regions = regionsFor(country);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          name={`${prefix}Line1`}
          placeholder="Address line 1"
          defaultValue={defaults?.line1 ?? ''}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
        <input
          name={`${prefix}Line2`}
          placeholder="Address line 2 (optional)"
          defaultValue={defaults?.line2 ?? ''}
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <input
          name={`${prefix}City`}
          placeholder="City"
          defaultValue={defaults?.city ?? ''}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
        {regions ? (
          <Select
            name={`${prefix}Region`}
            defaultValue={defaults?.region ?? ''}
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
            defaultValue={defaults?.region ?? ''}
            disabled={disabled}
            className={inputClass}
          />
        )}
        <input
          name={`${prefix}PostalCode`}
          placeholder="Zip/Postal code"
          defaultValue={defaults?.postalCode ?? ''}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
      </div>

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

export function BrandDetailsForm({ brand }: { brand: Brand }) {
  const action = saveBrandDetailsAction.bind(null, brand);
  const [state, formAction, pending] = useActionState(action, initialState);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoSrc = logoPreview ?? brand.logoUrl;

  const [mailingCountry, setMailingCountry] = useState(brand.mailingAddress?.country ?? 'US');
  const [billingCountry, setBillingCountry] = useState(
    brand.billingAddress?.country ?? brand.mailingAddress?.country ?? 'US',
  );
  const [sameAsMailing, setSameAsMailing] = useState(
    brand.billingAddress === null || addressEquals(brand.billingAddress, brand.mailingAddress),
  );

  const businessTypeId = useId();

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setLogoPreview(null);
      setLogoError(undefined);
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
  }

  return (
    // Capped, not full width: a single-column-per-field form stretched across
    // a wide monitor is harder to scan, not easier — same reasoning as
    // PageContainer's own `narrow` variant, which this matches (max-w-2xl).
    <form action={formAction} className="max-w-2xl space-y-8">
      <input type="hidden" name="sameAsMailing" value={sameAsMailing ? '1' : ''} />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">General Information</h2>

        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload business logo"
            className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full text-2xl
                       font-bold text-white focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-slate-900 focus-visible:ring-offset-2"
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
            className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full
                       border-2 border-white bg-blue-600 text-white shadow-sm"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
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

        <div className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field
            label="Legal Business Name"
            name="legalName"
            required
            defaultValue={brand.legalName}
            placeholder="Enter legal business name"
          />
          {/* The brand's trading name — what customers see — distinct from the
              legal name above where the two differ. */}
          <Field
            label="DBA (doing business as)"
            name="displayName"
            required
            defaultValue={brand.displayName}
            placeholder="Enter DBA"
          />
          <label className="block" htmlFor={businessTypeId}>
            <span className={labelClass}>Business Type</span>
            <Select
              id={businessTypeId}
              name="businessType"
              required
              defaultValue={brand.businessType ?? ''}
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
            defaultValue={brand.email ?? ''}
            placeholder="Enter business email"
          />
          <Field
            label="Business Phone"
            name="phone"
            type="tel"
            defaultValue={brand.phone ?? ''}
            placeholder="Enter phone number"
          />
          <Field
            label="Tax ID / EIN"
            name="taxId"
            defaultValue={brand.taxId ?? ''}
            placeholder="Enter Tax ID/EIN"
          />
        </div>
      </section>

      <hr className="border-t border-[#E5E7EB]" />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">Mailing Address</h2>
        <AddressFields
          prefix="mailing"
          country={mailingCountry}
          onCountryChange={setMailingCountry}
          defaults={brand.mailingAddress}
        />
      </section>

      <hr className="border-t border-[#E5E7EB]" />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">Billing Address</h2>
        <Toggle
          id="same-as-mailing"
          checked={sameAsMailing}
          onChange={setSameAsMailing}
          label="Same as Mailing address"
        />
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            sameAsMailing ? 'grid-rows-[0fr]' : 'mt-5 grid-rows-[1fr]'
          }`}
        >
          <div className="overflow-hidden">
            <fieldset disabled={sameAsMailing}>
              <AddressFields
                prefix="billing"
                country={billingCountry}
                onCountryChange={setBillingCountry}
                disabled={sameAsMailing}
                defaults={brand.billingAddress}
              />
            </fieldset>
          </div>
        </div>
      </section>

      {state.error && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-[10px] bg-black px-6 py-3 text-sm font-bold text-white transition-colors
                   hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
      >
        {pending ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  );
}
