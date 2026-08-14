'use client';

import { useActionState, useId, useState } from 'react';
import { COUNTRIES, regionsFor } from '@fenwick/shared';
import type { Brand } from '@/lib/api';
import { Select } from '@/components/ui/select';
import {
  STATIC_FIELD_INPUT_CLASS as inputClass,
  STATIC_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { saveBrandDetailsAction, type BrandDetailsState } from './actions';

const initialState: BrandDetailsState = {};

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

export function BrandDetailsForm({ brand }: { brand: Brand }) {
  const action = saveBrandDetailsAction.bind(null, brand);
  const [state, formAction, pending] = useActionState(action, initialState);

  const [country, setCountry] = useState(brand.mailingAddress?.country ?? 'US');
  const regions = regionsFor(country);

  const legalNameId = useId();

  return (
    <form action={formAction} className="space-y-8">
      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">General Information</h2>
        <div className="space-y-5">
          <div id={legalNameId}>
            <Field
              label="Legal Name"
              name="legalName"
              required
              defaultValue={brand.legalName}
              placeholder="Enter legal business name"
            />
          </div>
          <Field
            label="Sales Person"
            name="salesPerson"
            defaultValue={brand.salesPerson ?? ''}
            placeholder="Enter sales person"
          />
          <Field
            label="Phone Number"
            name="phone"
            type="tel"
            defaultValue={brand.phone ?? ''}
            placeholder="Enter phone number"
          />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={brand.email ?? ''}
            placeholder="Enter business email"
          />
        </div>
      </section>

      <hr className="border-t border-[#E5E7EB]" />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">Mailing Address</h2>
        <div className="space-y-4">
          <input
            name="mailingLine1"
            placeholder="Address line 1"
            defaultValue={brand.mailingAddress?.line1 ?? ''}
            required
            className={inputClass}
          />
          <input
            name="mailingLine2"
            placeholder="Address line 2 (optional)"
            defaultValue={brand.mailingAddress?.line2 ?? ''}
            className={inputClass}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <input
              name="mailingCity"
              placeholder="City"
              defaultValue={brand.mailingAddress?.city ?? ''}
              required
              className={inputClass}
            />
            {regions ? (
              <Select
                name="mailingRegion"
                defaultValue={brand.mailingAddress?.region ?? ''}
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
                name="mailingRegion"
                placeholder="State/Province"
                defaultValue={brand.mailingAddress?.region ?? ''}
                className={inputClass}
              />
            )}
            <input
              name="mailingPostalCode"
              placeholder="Zip/Postal code"
              defaultValue={brand.mailingAddress?.postalCode ?? ''}
              required
              className={inputClass}
            />
          </div>

          <Select name="mailingCountry" value={country} onChange={setCountry}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
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
