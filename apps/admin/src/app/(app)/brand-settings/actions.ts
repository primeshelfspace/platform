'use server';

import { revalidatePath } from 'next/cache';
import { DEFAULT_BRAND_BUSINESS_TYPE, isBusinessType } from '@fenwick/shared';
import {
  getPaymentPageDisplaySettings,
  sendEmailReceiptTest,
  updateBrand,
  updateEmailReceiptSettings,
  updateInvoicePdfSettings,
  updatePaymentPageDisplaySettings,
  uploadBrandLogo,
  type Brand,
  type BrandFormInput,
  type EmailReceiptLayout,
  type InvoicePdfLayout,
  type InvoicePdfPaymentTerms,
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
 * this form doesn't show (sales person, currency, timezone) are carried
 * forward unchanged from the brand already loaded into the page, not
 * re-collected here.
 */
export async function saveBrandDetailsAction(
  brand: Brand,
  _prevState: BrandDetailsState,
  formData: FormData,
): Promise<BrandDetailsState> {
  const legalName = emptyToNull(formData.get('legalName'));
  if (!legalName) return { error: 'Legal business name is required.' };

  const displayName = emptyToNull(formData.get('displayName'));
  if (!displayName) return { error: 'DBA (doing business as) is required.' };

  const businessTypeRaw = emptyToNull(formData.get('businessType'));
  if (!isBusinessType(businessTypeRaw)) return { error: 'Select a business type.' };

  const mailingAddress = addressFromForm(formData, 'mailing');
  if (!mailingAddress) return { error: 'Mailing address is required.' };

  // "Same as Mailing address" is enforced client-side by disabling the
  // billing fields, so reading mailingAddress here rather than re-parsing
  // disabled inputs keeps the two addresses byte-identical.
  const sameAsMailing = formData.get('sameAsMailing') === '1';
  const billingAddress = sameAsMailing ? mailingAddress : addressFromForm(formData, 'billing');

  const themeColor = emptyToNull(formData.get('themeColor')) ?? brand.themeColor;

  const input: BrandFormInput = {
    legalName,
    displayName,
    businessType: businessTypeRaw,
    salesPersonName: brand.salesPerson,
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    mailingAddress,
    billingAddress,
    taxId: emptyToNull(formData.get('taxId')),
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

export interface InvoicePdfState {
  readonly error?: string;
  readonly success?: boolean;
}

const INVOICE_PDF_LAYOUTS: readonly InvoicePdfLayout[] = ['CLASSIC', 'MODERN', 'MINIMAL'];
const INVOICE_PDF_PAYMENT_TERMS: readonly InvoicePdfPaymentTerms[] = [
  'DUE_ON_RECEIPT',
  'NET_15',
  'NET_30',
  'NET_60',
];

/**
 * Brand Settings > Branding > Invoice PDF. Brand colour and accent colour
 * are the same two fields Payment Page/Email Receipt edit — there is only
 * one of each per brand — so accent colour is read-then-written against
 * Payment Page's own settings to avoid silently reverting its layout choice.
 */
export async function saveInvoicePdfSettingsAction(
  brand: Brand,
  _prevState: InvoicePdfState,
  formData: FormData,
): Promise<InvoicePdfState> {
  const themeColor = emptyToNull(formData.get('themeColor')) ?? brand.themeColor;
  const accentColor = emptyToNull(formData.get('accentColor')) ?? '#171717';
  const layoutRaw = emptyToNull(formData.get('invoicePdfLayout'));
  const invoicePdfLayout = INVOICE_PDF_LAYOUTS.find((l) => l === layoutRaw) ?? 'CLASSIC';
  const paymentTermsRaw = emptyToNull(formData.get('paymentTerms'));
  const paymentTerms =
    INVOICE_PDF_PAYMENT_TERMS.find((t) => t === paymentTermsRaw) ?? 'DUE_ON_RECEIPT';
  const notes = emptyToNull(formData.get('notes')) ?? '';

  if (!notes) return { error: 'Notes are required.' };

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

    await updateInvoicePdfSettings(brand.id, {
      invoicePdfLayout,
      showCompanyAddress: formData.get('showCompanyAddress') === 'on',
      showPaymentTerms: formData.get('showPaymentTerms') === 'on',
      showTaxBreakdown: formData.get('showTaxBreakdown') === 'on',
      showNotes: formData.get('showNotes') === 'on',
      companyName: emptyToNull(formData.get('companyName')),
      companyAddress: emptyToNull(formData.get('companyAddress')),
      paymentTerms,
      notes,
    });
  } catch (error) {
    return { error: describeActionError(error, 'Could not save the invoice PDF settings.') };
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
