'use server';

import { redirect } from 'next/navigation';
import {
  DEFAULT_BRAND_CURRENCY,
  DEFAULT_BRAND_THEME_COLOR,
  DEFAULT_BRAND_TIMEZONE,
} from '@fenwick/shared';
import {
  ApiError,
  completeMultiBrandOnboarding,
  createBrand,
  getMerchantOnboarding,
  uploadBrandLogo,
  type BrandFormInput,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

export interface CreateBrandsState {
  readonly error?: string;
}

/** No dedicated prefix field on this quick setup form — derived from the name
 * instead, falling back to a fixed default when nothing usable survives the
 * strip (e.g. a name that's all punctuation or non-Latin). */
function invoicePrefixFrom(legalName: string): string {
  const derived = legalName
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return derived || 'INV';
}

/**
 * FR-ONB step 3 (multi-brand): creates every named brand, then finishes
 * onboarding and lands on the dashboard.
 *
 * Names and logos arrive as parallel repeated fields, so they zip by index —
 * every row renders both inputs, including an empty file, which is what keeps
 * the two lists aligned when a middle row is left blank.
 *
 * Brands are created in order and a failure stops there rather than rolling
 * back: brands already created are real and useful, and the merchant can add
 * the rest from the dashboard. Silently discarding successful work to make the
 * call atomic would be the worse outcome.
 */
export async function createBrandsAction(
  _prevState: CreateBrandsState,
  formData: FormData,
): Promise<CreateBrandsState> {
  const names = formData.getAll('brandName').map((v) => String(v).trim());
  const logos = formData.getAll('brandLogo');

  const entries = names
    .map((name, index) => ({ name, logo: logos[index] }))
    .filter((entry) => entry.name.length > 0);

  if (entries.length === 0) return { error: 'Give at least one brand a name.' };

  // The merchant already told us its legal structure on the Company Details
  // step, so every brand inherits it rather than being pinned to a guess. This
  // form only asks for a name; anything it does not ask, it must not invent.
  const { companyDetails } = await getMerchantOnboarding();

  for (const entry of entries) {
    // invoicePrefix is create-only, which is why it sits outside BrandFormInput.
    const input: BrandFormInput & { invoicePrefix: string } = {
      legalName: entry.name,
      displayName: entry.name,
      businessType: companyDetails?.businessType ?? 'LLC',
      salesPersonName: null,
      phone: null,
      email: null,
      mailingAddress: null,
      billingAddress: null,
      taxId: null,
      currency: DEFAULT_BRAND_CURRENCY,
      timezone: DEFAULT_BRAND_TIMEZONE,
      themeColor: DEFAULT_BRAND_THEME_COLOR,
      invoicePrefix: invoicePrefixFrom(entry.name),
    };

    let brandId: string;
    try {
      brandId = (await createBrand(input)).id;
    } catch (error) {
      return { error: describeActionError(error, `Could not create "${entry.name}".`) };
    }

    // The logo is uploaded after creation because its storage key is
    // namespaced by brand id — there is nothing to upload to until the brand
    // exists. A failure here is not worth losing the brand over; it can be
    // set later from brand settings.
    if (entry.logo instanceof File && entry.logo.size > 0) {
      try {
        await uploadBrandLogo(brandId, entry.logo);
      } catch {
        // Intentionally ignored — see above.
      }
    }
  }

  try {
    await completeMultiBrandOnboarding();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: describeActionError(error, 'Could not finish setup.') };
  }

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful setup into an error message.
  redirect('/');
}
