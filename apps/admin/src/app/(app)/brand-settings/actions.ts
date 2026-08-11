'use server';

import { revalidatePath } from 'next/cache';
import {
  updateBrand,
  updatePaymentPageDisplaySettings,
  uploadBrandLogo,
  type Brand,
  type BrandFormInput,
  type PaymentPageDisplaySettings,
  type PaymentPageLayout,
} from '@/lib/api';
import { addressFromForm, describeActionError, emptyToNull } from '@/lib/form';

export interface BrandDetailsState {
  readonly error?: string;
  readonly success?: boolean;
}

/**
 * Bound to the brand being edited via `.bind(null, brand)` in the client
 * form, since useActionState's action signature has no room for it otherwise.
 *
 * A full replace, not a partial patch (see BrandsService.update) — fields
 * this form doesn't show (business type, tax id, billing address, currency,
 * timezone) are carried forward unchanged from the brand already loaded into
 * the page, not re-collected here.
 */
export async function saveBrandDetailsAction(
  brand: Brand,
  _prevState: BrandDetailsState,
  formData: FormData,
): Promise<BrandDetailsState> {
  const legalName = emptyToNull(formData.get('legalName'));
  if (!legalName) return { error: 'Legal name is required.' };

  const mailingAddress = addressFromForm(formData, 'mailing');
  if (!mailingAddress) return { error: 'Mailing address is required.' };

  const themeColor = emptyToNull(formData.get('themeColor')) ?? brand.themeColor;

  const input: BrandFormInput = {
    legalName,
    displayName: brand.displayName,
    businessType: brand.businessType ?? 'LLC',
    salesPersonName: emptyToNull(formData.get('salesPerson')),
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    mailingAddress,
    billingAddress: brand.billingAddress,
    taxId: brand.taxId,
    currency: brand.currency,
    timezone: brand.timezone,
    themeColor,
  };

  try {
    await updateBrand(brand.id, input);
  } catch (error) {
    return { error: describeActionError(error, 'Could not save these details.') };
  }

  // Same convention as the onboarding Company Details form: a failed logo
  // upload does not fail the save that already succeeded.
  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try {
      await uploadBrandLogo(brand.id, logo);
    } catch {
      // Intentionally ignored — see comment above.
    }
  }

  revalidatePath('/brand-settings');
  return { success: true };
}

export interface PaymentPageDisplayState {
  readonly error?: string;
  readonly success?: boolean;
}

const PAYMENT_PAGE_LAYOUTS: readonly PaymentPageLayout[] = ['BANNER', 'CENTERED', 'SPLIT'];

/**
 * Brand Settings > Branding > Payment Page. Saves the brand colour (the same
 * field Brand Details edits — there is only one themeColor per brand) plus
 * the payment-page-only accent colour and layout, which live on
 * BrandSettings rather than Brand itself.
 */
export async function savePaymentPageDisplayAction(
  brand: Brand,
  _prevState: PaymentPageDisplayState,
  formData: FormData,
): Promise<PaymentPageDisplayState> {
  const themeColor = emptyToNull(formData.get('themeColor')) ?? brand.themeColor;
  const accentColor = emptyToNull(formData.get('accentColor')) ?? '#171717';
  const layoutRaw = emptyToNull(formData.get('paymentPageLayout'));
  const paymentPageLayout = PAYMENT_PAGE_LAYOUTS.find((l) => l === layoutRaw) ?? 'BANNER';

  try {
    if (themeColor !== brand.themeColor) {
      const input: BrandFormInput = {
        legalName: brand.legalName,
        displayName: brand.displayName,
        businessType: brand.businessType ?? 'LLC',
        salesPersonName: brand.salesPerson,
        phone: brand.phone,
        email: brand.email,
        mailingAddress: brand.mailingAddress,
        billingAddress: brand.billingAddress,
        taxId: brand.taxId,
        currency: brand.currency,
        timezone: brand.timezone,
        themeColor,
      };
      await updateBrand(brand.id, input);
    }

    const display: PaymentPageDisplaySettings = { accentColor, paymentPageLayout };
    await updatePaymentPageDisplaySettings(brand.id, display);
  } catch (error) {
    return { error: describeActionError(error, 'Could not save the payment page display.') };
  }

  // Same convention as Brand Details: a failed logo upload does not fail the
  // save that already succeeded.
  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try {
      await uploadBrandLogo(brand.id, logo);
    } catch {
      // Intentionally ignored — see comment above.
    }
  }

  revalidatePath('/brand-settings');
  return { success: true };
}
