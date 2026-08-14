'use server';

import { revalidatePath } from 'next/cache';
import { DEFAULT_BRAND_BUSINESS_TYPE } from '@fenwick/shared';
import {
  getPaymentPageDisplaySettings,
  sendEmailReceiptTest,
  updateBrand,
  updateEmailReceiptSettings,
  updatePaymentPageDisplaySettings,
  uploadBrandLogo,
  type Brand,
  type BrandFormInput,
  type EmailReceiptLayout,
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
    businessType: brand.businessType ?? DEFAULT_BRAND_BUSINESS_TYPE,
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
        businessType: brand.businessType ?? DEFAULT_BRAND_BUSINESS_TYPE,
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

export interface EmailReceiptState {
  readonly error?: string;
  readonly success?: boolean;
}

const EMAIL_RECEIPT_LAYOUTS: readonly EmailReceiptLayout[] = ['CLASSIC', 'HERO', 'MINIMAL'];

/**
 * Brand Settings > Branding > Email Receipt. Brand colour and accent colour
 * are the same two fields Payment Page edits — there is only one of each per
 * brand — so accent colour is read-then-written against Payment Page's own
 * settings to avoid silently reverting its layout choice to the default.
 */
export async function saveEmailReceiptSettingsAction(
  brand: Brand,
  _prevState: EmailReceiptState,
  formData: FormData,
): Promise<EmailReceiptState> {
  const themeColor = emptyToNull(formData.get('themeColor')) ?? brand.themeColor;
  const accentColor = emptyToNull(formData.get('accentColor')) ?? '#171717';
  const layoutRaw = emptyToNull(formData.get('emailReceiptLayout'));
  const emailReceiptLayout = EMAIL_RECEIPT_LAYOUTS.find((l) => l === layoutRaw) ?? 'CLASSIC';
  const emailReceiptSubject = emptyToNull(formData.get('emailReceiptSubject'));
  const emailReceiptBody = emptyToNull(formData.get('emailReceiptBody'));

  if (!emailReceiptSubject) return { error: 'Subject is required.' };
  if (!emailReceiptBody) return { error: 'Body is required.' };

  try {
    if (themeColor !== brand.themeColor) {
      const input: BrandFormInput = {
        legalName: brand.legalName,
        displayName: brand.displayName,
        businessType: brand.businessType ?? DEFAULT_BRAND_BUSINESS_TYPE,
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

    const currentDisplay = await getPaymentPageDisplaySettings(brand.id);
    if (accentColor !== currentDisplay.accentColor) {
      await updatePaymentPageDisplaySettings(brand.id, { ...currentDisplay, accentColor });
    }

    await updateEmailReceiptSettings(brand.id, {
      emailReceiptLayout,
      emailReceiptSubject,
      emailReceiptBody,
    });
  } catch (error) {
    return { error: describeActionError(error, 'Could not save the email receipt settings.') };
  }

  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try {
      await uploadBrandLogo(brand.id, logo);
    } catch {
      // Intentionally ignored — see the same convention above.
    }
  }

  revalidatePath('/brand-settings');
  return { success: true };
}

export interface SendTestEmailState {
  readonly error?: string;
  readonly success?: boolean;
}

/** Sends whatever subject/body is currently in the form — not what's saved —
 * so a draft can be tested before committing to it. */
export async function sendTestEmailAction(
  brand: Brand,
  _prevState: SendTestEmailState,
  formData: FormData,
): Promise<SendTestEmailState> {
  const to = emptyToNull(formData.get('to'));
  const emailReceiptSubject = emptyToNull(formData.get('emailReceiptSubject'));
  const emailReceiptBody = emptyToNull(formData.get('emailReceiptBody'));

  if (!to) return { error: 'Enter an email address.' };
  if (!emailReceiptSubject || !emailReceiptBody) {
    return { error: 'Subject and body are required.' };
  }

  try {
    await sendEmailReceiptTest(brand.id, { to, emailReceiptSubject, emailReceiptBody });
  } catch (error) {
    return { error: describeActionError(error, 'Could not send the test email.') };
  }

  return { success: true };
}
