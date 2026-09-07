'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
  COUNTRIES,
  regionsFor,
  normalizeUsPhone,
  isValidUsZip,
  isValidEin,
  normalizeWebsiteDomain,
  checkBusinessEmail,
  emailSchema,
} from '@fenwick/shared';

import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS } from '@fenwick/shared';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import {
  FIELD_INVALID_BORDER as invalidBorder,
  FIELD_VALID_BORDER_PRIMARY as validBorder,
  VALIDATED_FIELD_INPUT_CLASS as inputClass,
  VALIDATED_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import { saveCompanyDetailsAction, type CompanyDetailsState } from './actions';

const initialState: CompanyDetailsState = {};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml'];

interface FieldErrors {
  businessType?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  taxId?: string;
  mailingLine1?: string;
  mailingCity?: string;
  mailingRegion?: string;
  mailingPostalCode?: string;
  billingLine1?: string;
  billingCity?: string;
  billingRegion?: string;
  billingPostalCode?: string;
}

function Field({
  label,
  name,
  error,
  errorId,
  hint,
  ...rest
}: { label: string; name: string; error?: string; errorId?: string; hint?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'name' | 'className'
>) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label}
        {hint && <span className="ml-1 font-normal text-[#94A3B8]">{hint}</span>}
      </span>
      <input
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`${inputClass} ${error ? invalidBorder : validBorder}`}
        {...rest}
      />
      {error && errorId && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}

function AddressFields({
  prefix,
  country,
  onCountryChange,
  disabled,
  errors,
}: {
  prefix: 'mailing' | 'billing';
  country: string;
  onCountryChange: (code: string) => void;
  disabled?: boolean;
  errors: FieldErrors;
}) {
  const regions = regionsFor(country);
  const line1Error = errors[`${prefix}Line1` as const];
  const cityError = errors[`${prefix}City` as const];
  const regionError = errors[`${prefix}Region` as const];
  const postalError = errors[`${prefix}PostalCode` as const];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          name={`${prefix}Line1`}
          placeholder="Address line 1"
          disabled={disabled}
          aria-invalid={Boolean(line1Error)}
          className={`${inputClass} ${line1Error ? invalidBorder : validBorder}`}
        />
        <input
          name={`${prefix}Line2`}
          placeholder="Address line 2 (optional)"
          disabled={disabled}
          className={`${inputClass} ${validBorder}`}
        />
      </div>
      {line1Error && (
        <p role="alert" className="-mt-2.5 text-sm text-red-600">
          {line1Error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <input
          name={`${prefix}City`}
          placeholder="City"
          disabled={disabled}
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
            disabled={disabled}
            aria-invalid={Boolean(regionError)}
            className={`${inputClass} ${regionError ? invalidBorder : validBorder}`}
          />
        )}
        <input
          name={`${prefix}PostalCode`}
          placeholder="Zip/Postal code"
          disabled={disabled}
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

export function CompanyDetailsForm() {
  const [state, formAction, pending] = useActionState(saveCompanyDetailsAction, initialState);
  useFormStatusToast(state);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mailingCountry, setMailingCountry] = useState('US');
  const [billingCountry, setBillingCountry] = useState('US');
  const [sameAsMailing, setSameAsMailing] = useState(true);

  const emailErrorId = useId();
  const phoneErrorId = useId();
  const legalNameErrorId = useId();
  const businessTypeErrorId = useId();
  const taxIdErrorId = useId();
  const websiteErrorId = useId();

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

  function validate(formData: FormData): FieldErrors {
    const errors: FieldErrors = {};
    const get = (key: string) => String(formData.get(key) ?? '').trim();

    if (!get('legalName')) errors.legalName = 'Legal business name is required.';
    if (!get('businessType')) errors.businessType = 'Select a business type.';

    const website = get('website');
    const websiteDomain = website ? normalizeWebsiteDomain(website) : null;
    if (website && !websiteDomain) {
      errors.website = 'Enter a valid company website, e.g. acme.com.';
    }

    const email = get('email');
    if (!email) errors.email = 'Brand email is required.';
    else if (!emailSchema.safeParse(email).success) errors.email = 'Enter a valid email address.';
    else {
      const businessEmail = checkBusinessEmail(email, websiteDomain);
      if (!businessEmail.ok) {
        errors.email =
          businessEmail.reason === 'DOMAIN_MISMATCH'
            ? "This email doesn't match your company website's domain."
            : businessEmail.reason === 'FREE_PROVIDER'
              ? 'Use your company email address, not a personal email provider.'
              : 'Enter a valid email address.';
      }
    }

    const phone = get('phone');
    if (!phone) errors.phone = 'Brand phone is required.';
    else if (!normalizeUsPhone(phone)) {
      errors.phone = 'Enter a valid US phone number, e.g. (212) 555-1234.';
    }

    const taxId = get('taxId');
    if (taxId && mailingCountry === 'US' && !isValidEin(taxId)) {
      errors.taxId = 'A US Tax ID must be an EIN in the form 12-3456789.';
    }

    if (!get('mailingLine1')) errors.mailingLine1 = 'Address line 1 is required.';
    if (!get('mailingCity')) errors.mailingCity = 'City is required.';
    if (!get('mailingRegion')) errors.mailingRegion = 'State/Province is required.';
    const mailingPostalCode = get('mailingPostalCode');
    if (!mailingPostalCode) errors.mailingPostalCode = 'Zip/Postal code is required.';
    else if (mailingCountry === 'US' && !isValidUsZip(mailingPostalCode)) {
      errors.mailingPostalCode = 'Enter a valid ZIP code, e.g. 12345 or 12345-6789.';
    }

    if (!sameAsMailing) {
      if (!get('billingLine1')) errors.billingLine1 = 'Address line 1 is required.';
      if (!get('billingCity')) errors.billingCity = 'City is required.';
      if (!get('billingRegion')) errors.billingRegion = 'State/Province is required.';
      const billingPostalCode = get('billingPostalCode');
      if (!billingPostalCode) errors.billingPostalCode = 'Zip/Postal code is required.';
      else if (billingCountry === 'US' && !isValidUsZip(billingPostalCode)) {
        errors.billingPostalCode = 'Enter a valid ZIP code, e.g. 12345 or 12345-6789.';
      }
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
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-8">
      <input type="hidden" name="sameAsMailing" value={sameAsMailing ? '1' : ''} />
      {/* Not asked on this simplified onboarding form — defaults to the most
          common small-business structure and can be corrected later from
          brand settings once that screen exists. */}

      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload business logo"
          className="flex h-[100px] w-[100px] items-center justify-center overflow-hidden rounded-full bg-[#F1F5F9]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          {logoPreview ? (
            // Local object URL preview of a file the user just picked, not a remote image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPreview} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-8 w-8 text-[#94A3B8]" aria-hidden />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          name="logo"
          accept="image/jpeg,image/png,image/svg+xml"
          onChange={handleLogoChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 rounded-[10px] border border-[#D1D5DB] bg-white px-5 py-2.5 text-sm font-bold
                     text-[#0F172A] transition-colors hover:bg-slate-50 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
        >
          Upload Business Logo
        </button>
        {logoError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {logoError}
          </p>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field
          label="Legal Business Name"
          name="legalName"
          required
          placeholder="Enter legal business name"
          error={fieldErrors.legalName}
          errorId={legalNameErrorId}
        />
        {/* Optional: most businesses trade under their legal name. */}
        <Field label="DBA (doing business as)" name="dba" placeholder="Enter DBA" />
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#0F172A]">Business Type</span>
          <Select
            name="businessType"
            required
            placeholder="Select type"
            error={fieldErrors.businessType}
            errorId={businessTypeErrorId}
          >
            {BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>
                {BUSINESS_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
          {fieldErrors.businessType && (
            <p id={businessTypeErrorId} role="alert" className="mt-1.5 text-sm text-red-600">
              {fieldErrors.businessType}
            </p>
          )}
        </label>
        <Field
          label="Business Email"
          name="email"
          type="email"
          required
          placeholder="Enter business email"
          error={fieldErrors.email}
          errorId={emailErrorId}
        />
        <Field
          label="Business Phone"
          name="phone"
          type="tel"
          required
          placeholder="(212) 555-1234"
          error={fieldErrors.phone}
          errorId={phoneErrorId}
        />
        <Field
          label="Company Website"
          name="website"
          hint="(optional)"
          placeholder="acme.com"
          error={fieldErrors.website}
          errorId={websiteErrorId}
        />
        <Field
          label="Tax ID / EIN"
          name="taxId"
          hint="(optional)"
          placeholder="Enter Tax ID/EID"
          error={fieldErrors.taxId}
          errorId={taxIdErrorId}
        />
      </div>

      <hr className="border-t border-[#E5E7EB]" />

      <div>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">Mailing Address</h2>
        <AddressFields
          prefix="mailing"
          country={mailingCountry}
          onCountryChange={setMailingCountry}
          errors={fieldErrors}
        />
      </div>

      <hr className="border-t border-[#E5E7EB]" />

      <div>
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
                errors={fieldErrors}
              />
            </fieldset>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[10px] bg-black px-4 py-3.5 text-base font-bold text-white
                   transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                   disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-black focus-visible:ring-offset-2"
      >
        {pending ? 'Saving…' : 'Save & Continue'}
      </button>
    </form>
  );
}
