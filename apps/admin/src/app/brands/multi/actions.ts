'use server';

import { redirect } from 'next/navigation';
import {
  ApiError,
  completeMultiBrandOnboarding,
  createBrand,
  type BrandFormInput,
} from '@/lib/api';
import { emptyToNull } from '@/lib/form';

export interface AddBrandState {
  readonly error?: string;
}

/** No dedicated prefix field on this quick add-a-brand form — derived from
 * the name instead, falling back to a fixed default when nothing usable
 * survives the strip (e.g. a name that's all punctuation or non-Latin). */
function invoicePrefixFrom(legalName: string): string {
  const derived = legalName
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return derived || 'INV';
}

/**
 * Adds one brand and returns to this same page so the running list reflects
 * it — no client-side list state to keep in sync, just a fresh server
 * render. Deliberately lighter than the Company Details form: no address,
 * tax id, or logo fields, since a multi-brand merchant is expected to visit
 * each brand's own settings later to fill those in.
 */
export async function addBrandAction(
  _prevState: AddBrandState,
  formData: FormData,
): Promise<AddBrandState> {
  const legalName = emptyToNull(formData.get('legalName'));
  if (!legalName) return { error: 'Brand name is required.' };

  const input: BrandFormInput & { invoicePrefix: string } = {
    legalName,
    displayName: legalName,
    businessType: 'LLC',
    salesPersonName: null,
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    mailingAddress: null,
    billingAddress: null,
    taxId: null,
    currency: 'USD',
    timezone: 'America/New_York',
    themeColor: '#2D6A6A',
    invoicePrefix: invoicePrefixFrom(legalName),
  };

  try {
    await createBrand(input);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not add this brand.' };
  }

  redirect('/brands/multi');
}

export interface FinishSetupState {
  readonly error?: string;
}

export async function finishMultiBrandSetupAction(
  _prevState: FinishSetupState,
  _formData: FormData,
): Promise<FinishSetupState> {
  try {
    await completeMultiBrandOnboarding();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not finish setup.' };
  }

  redirect('/');
}
