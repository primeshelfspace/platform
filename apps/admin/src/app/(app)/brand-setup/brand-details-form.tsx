'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Pencil } from 'lucide-react';
import { BRAND_COLOUR_PRESETS, COUNTRIES, regionsFor } from '@fenwick/shared';
import type { Brand } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { saveBrandDetailsAction, type BrandDetailsState } from './actions';

const initialState: BrandDetailsState = {};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml'];

const inputClass =
  'w-full rounded-[10px] border border-[#D1D5DB] bg-white px-4 py-3 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-slate-900 focus-visible:ring-offset-1 transition-colors';
const labelClass = 'mb-2 block text-sm font-bold text-[#0F172A]';

/** Fixed swatches plus one open slot for any colour a brand already carries
 * that isn't one of these — a brand created before this picker existed, or
 * one someone picked with the custom swatch previously, must still show its
 * actual colour as selected rather than silently falling back to a preset. */
const SWATCHES = [...BRAND_COLOUR_PRESETS, '#000000'] as const;

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
      <input
        name={name}
        defaultValue={defaultValue}
        className={inputClass}
        {...rest}
      />
    </label>
  );
}

export function BrandDetailsForm({ brand }: { brand: Brand }) {
  const action = saveBrandDetailsAction.bind(null, brand);
  const [state, formAction, pending] = useActionState(action, initialState);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [themeColor, setThemeColor] = useState(brand.themeColor);
  const [country, setCountry] = useState(brand.mailingAddress?.country ?? 'US');
  const regions = regionsFor(country);

  const legalNameId = useId();

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

  const initial = (brand.displayName || brand.legalName || '?').charAt(0).toUpperCase();

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="themeColor" value={themeColor} />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">Brand Identity</h2>
        <div className="flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload brand logo"
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-xl font-bold text-white
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            style={{ backgroundColor: logoPreview || brand.logoUrl ? undefined : themeColor }}
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-full w-full object-cover" />
            ) : brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
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
            className="flex items-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-5 py-2.5 text-sm font-bold
                       text-[#0F172A] transition-colors hover:bg-slate-50 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          >
            <ImageIcon className="h-4 w-4" aria-hidden />
            Upload Logo
          </button>
        </div>
        {logoError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {logoError}
          </p>
        )}

        <div className="mt-5">
          <span className={labelClass}>Brand Color</span>
          <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Brand colour">
            {SWATCHES.map((swatch) => {
              const selected = swatch.toLowerCase() === themeColor.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={swatch}
                  onClick={() => setThemeColor(swatch)}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-105
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                  style={{ backgroundColor: swatch }}
                >
                  {selected && <Check className="h-4 w-4 text-white" aria-hidden />}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => colorInputRef.current?.click()}
              aria-label="Choose a custom colour"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D1D5DB] bg-white text-[#64748B]
                         transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <input
              ref={colorInputRef}
              type="color"
              value={themeColor}
              onChange={(event) => setThemeColor(event.target.value)}
              className="sr-only"
              aria-hidden
              tabIndex={-1}
            />
          </div>
        </div>
      </section>

      <hr className="border-t border-[#E5E7EB]" />

      <section>
        <h2 className="mb-4 text-base font-bold text-[#0F172A]">General Information</h2>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <input
              name="mailingCity"
              placeholder="City"
              defaultValue={brand.mailingAddress?.city ?? ''}
              required
              className={inputClass}
            />
            {regions ? (
              <Select name="mailingRegion" defaultValue={brand.mailingAddress?.region ?? ''} placeholder="State/Province">
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
