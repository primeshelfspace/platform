'use server';

import { redirect } from 'next/navigation';
import {
  ApiError,
  saveCompanyDetails,
  uploadCompanyLogo,
  type CompanyDetailsFormInput,
  type CustomerAddress,
} from '@/lib/api';
import { addressFromForm, describeApiError, emptyToNull } from '@/lib/form';

export interface CompanyDetailsState {
  readonly error?: string;
}

const BUSINESS_TYPES = new Set([
  'SOLE_PROPRIETORSHIP',
  'LLC',
  'CORPORATION',
  'PARTNERSHIP',
  'NONPROFIT',
]);

/**
 * FR-ONB step 1: stages company details on the merchant — no Brand exists
 * yet, since brand-structure (next) decides whether there is one brand or
 * several. Nothing here is a dead end on failure: a rejected save leaves the
 * user on this same form with the error, per useActionState — no redirect
 * happens until the API call actually succeeds.
 */
export async function saveCompanyDetailsAction(
  _prevState: CompanyDetailsState,
  formData: FormData,
): Promise<CompanyDetailsState> {
  const legalName = emptyToNull(formData.get('legalName'));
  const businessType = emptyToNull(formData.get('businessType'));

  if (!legalName) return { error: 'Brand name is required.' };
  if (!businessType || !BUSINESS_TYPES.has(businessType)) {
    return { error: 'Select a business type.' };
  }

  const mailingAddress = addressFromForm(formData, 'mailing');
  const sameAsMailing = formData.get('sameAsMailing') === '1';
  const billingAddress = sameAsMailing ? mailingAddress : addressFromForm(formData, 'billing');

  const input: CompanyDetailsFormInput = {
    legalName,
    dba: emptyToNull(formData.get('dba')),
    businessType: businessType as CompanyDetailsFormInput['businessType'],
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    mailingAddress,
    billingAddress,
    taxId: emptyToNull(formData.get('taxId')),
  };

  try {
    await saveCompanyDetails(input);
  } catch (error) {
    if (error instanceof ApiError) return { error: describeApiError(error) };
    return { error: error instanceof Error ? error.message : 'Could not save these details.' };
  }

  // A failed logo upload is not a failed company-details save — the rest of
  // onboarding proceeds regardless, and the logo can be added again later.
  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try {
      await uploadCompanyLogo(logo);
    } catch {
      // Intentionally ignored — see comment above.
    }
  }

  redirect('/brands/structure');
}
