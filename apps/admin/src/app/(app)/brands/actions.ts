'use server';

import { revalidatePath } from 'next/cache';
import {
  DEFAULT_BRAND_BUSINESS_TYPE,
  DEFAULT_BRAND_CURRENCY,
  DEFAULT_BRAND_THEME_COLOR,
  DEFAULT_BRAND_TIMEZONE,
} from '@fenwick/shared';
import { createBrand, uploadBrandLogo, type Brand, type BrandFormInput } from '@/lib/api';
import { describeActionError } from '@/lib/form';

export interface AddBrandState {
  readonly error?: string;
  readonly brandId?: string;
}

/** No dedicated prefix field on this quick form — derived from the name
 * instead, falling back to a fixed default when nothing usable survives the
 * strip (e.g. a name that's all punctuation or non-Latin). Same rule as the
 * onboarding multi-brand step, kept in sync deliberately. */
function invoicePrefixFrom(legalName: string): string {
  const derived = legalName
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return derived || 'INV';
}

/**
 * Adds one more brand to an already-onboarded merchant, from the sidebar's
 * "Add New Brand" menu item. Unlike the onboarding multi-brand step, there is
 * no onboarding state to advance here — this just creates a brand.
 *
 * Bound to the merchant's existing brands via `.bind(null, brands)` so the new
 * brand inherits business type, currency, and timezone from a brand that
 * already carries them, rather than guessing or defaulting to USD regardless
 * of what this merchant actually operates in.
 */
export async function addBrandAction(
  brands: Brand[],
  _prevState: AddBrandState,
  formData: FormData,
): Promise<AddBrandState> {
  const name = String(formData.get('brandName') ?? '').trim();
  if (!name) return { error: 'Enter a brand name.' };

  const reference = brands[0];
  const input: BrandFormInput & { invoicePrefix: string } = {
    legalName: name,
    displayName: name,
    businessType: reference?.businessType ?? DEFAULT_BRAND_BUSINESS_TYPE,
    salesPersonName: null,
    phone: null,
    email: null,
    mailingAddress: null,
    billingAddress: null,
    taxId: null,
    currency: reference?.currency ?? DEFAULT_BRAND_CURRENCY,
    timezone: reference?.timezone ?? DEFAULT_BRAND_TIMEZONE,
    themeColor: DEFAULT_BRAND_THEME_COLOR,
    invoicePrefix: invoicePrefixFrom(name),
  };

  let brand: Brand;
  try {
    brand = await createBrand(input);
  } catch (error) {
    return { error: describeActionError(error, `Could not create "${name}".`) };
  }

  // The logo is uploaded after creation because its storage key is namespaced
  // by brand id — there is nothing to upload to until the brand exists. A
  // failure here is not worth losing the brand over; it can be set later from
  // Brand Settings.
  const logo = formData.get('brandLogo');
  if (logo instanceof File && logo.size > 0) {
    try {
      await uploadBrandLogo(brand.id, logo);
    } catch {
      // Intentionally ignored — see above.
    }
  }

  // The sidebar's brand list comes from the (app) layout's server component;
  // this makes sure the newly created brand shows up there on the next
  // navigation instead of waiting for whatever cache window listBrands() has.
  revalidatePath('/', 'layout');
  return { brandId: brand.id };
}
