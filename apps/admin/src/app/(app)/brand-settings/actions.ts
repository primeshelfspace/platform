'use server';

import { revalidatePath } from 'next/cache';
import { isBusinessType } from '@fenwick/shared';
import {
  sendEmailReceiptTest,
  updateBrand,
  updateEmailReceiptSettings,
  updateInvoicePdfSettings,
  updatePaymentPageDisplaySettings,
  uploadBrandLogo,
  type Brand,
  type BrandElements,
  type BrandFormInput,
  type EmailReceiptLayout,
  type InvoicePdfLayout,
  type InvoicePdfPaymentTerms,
  type PaymentPageLayout,
} from '@/lib/api';
import { addressFromForm, describeActionError, emptyToNull } from '@/lib/form';

export interface BrandDetailsState {
  readonly error?: string;
  readonly success?: boolean;
  /** The save committed, but something alongside it did not — today only a
   * failed logo upload. Shown as a caution, not as a failure. */
  readonly warning?: string;
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

  const logoError = await saveLogo(brand.id, formData);

  revalidatePath('/brand-settings');
  return logoError ? { success: true, warning: logoError } : { success: true };
}

/**
 * A select/radio value read back off the form, checked against the values the
 * column actually accepts.
 *
 * Deliberately not `?? DEFAULT`: a missing or unrecognised value means the
 * form and this action disagree about the field, and quietly writing the
 * default would answer that by overwriting the merchant's saved choice with
 * one they never made. Better a visible error on a save that changed nothing.
 */
function readChoice<T extends string>(
  formData: FormData,
  field: string,
  allowed: readonly T[],
): T | null {
  const raw = emptyToNull(formData.get(field));
  return allowed.find((value) => value === raw) ?? null;
}

/** Same reasoning as readChoice, for the two Brand Elements colours: a
 * dropped colour field must not silently repaint the brand. */
function readBrandElements(formData: FormData): BrandElements | null {
  const themeColor = emptyToNull(formData.get('themeColor'));
  const accentColor = emptyToNull(formData.get('accentColor'));
  if (!themeColor || !accentColor) return null;
  if (!HEX_COLOUR.test(themeColor) || !HEX_COLOUR.test(accentColor)) return null;
  return { themeColor, accentColor };
}

const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Uploads the logo if one was picked. A failed upload does not fail the save
 * that already committed — the settings write is the thing the merchant
 * asked for — but it is returned so the form can say so, rather than
 * reporting an unqualified success for a logo that never landed.
 */
async function saveLogo(brandId: string, formData: FormData): Promise<string | null> {
  const logo = formData.get('logo');
  if (!(logo instanceof File) || logo.size === 0) return null;

  try {
    await uploadBrandLogo(brandId, logo);
    return null;
  } catch (error) {
    return describeActionError(error, 'Your settings were saved, but the logo did not upload.');
  }
}

const BRANDING_FORM_ERROR =
  'That form did not submit cleanly — nothing was saved. Reload the page and try again.';

export interface PaymentPageDisplayState {
  readonly error?: string;
  readonly success?: boolean;
  /** The save committed, but something alongside it did not — today only a
   * failed logo upload. Shown as a caution, not as a failure. */
  readonly warning?: string;
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
  const elements = readBrandElements(formData);
  const paymentPageLayout = readChoice(formData, 'paymentPageLayout', PAYMENT_PAGE_LAYOUTS);
  if (!elements || !paymentPageLayout) return { error: BRANDING_FORM_ERROR };

  try {
    await updatePaymentPageDisplaySettings(brand.id, { ...elements, paymentPageLayout });
  } catch (error) {
    return { error: describeActionError(error, 'Could not save the payment page display.') };
  }

  const logoError = await saveLogo(brand.id, formData);

  revalidatePath('/brand-settings');
  return logoError ? { success: true, warning: logoError } : { success: true };
}

export interface EmailReceiptState {
  readonly error?: string;
  readonly success?: boolean;
  /** The save committed, but something alongside it did not — today only a
   * failed logo upload. Shown as a caution, not as a failure. */
  readonly warning?: string;
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
  const elements = readBrandElements(formData);
  const emailReceiptLayout = readChoice(formData, 'emailReceiptLayout', EMAIL_RECEIPT_LAYOUTS);
  if (!elements || !emailReceiptLayout) return { error: BRANDING_FORM_ERROR };

  const emailReceiptSubject = emptyToNull(formData.get('emailReceiptSubject'));
  const emailReceiptBody = emptyToNull(formData.get('emailReceiptBody'));
  if (!emailReceiptSubject) return { error: 'Subject is required.' };
  if (!emailReceiptBody) return { error: 'Body is required.' };

  try {
    await updateEmailReceiptSettings(brand.id, {
      ...elements,
      emailReceiptLayout,
      emailReceiptSubject,
      emailReceiptBody,
    });
  } catch (error) {
    return { error: describeActionError(error, 'Could not save the email receipt settings.') };
  }

  const logoError = await saveLogo(brand.id, formData);

  revalidatePath('/brand-settings');
  return logoError ? { success: true, warning: logoError } : { success: true };
}

export interface SendTestEmailState {
  readonly error?: string;
  readonly success?: boolean;
}

/** Sends whatever is currently in the form — layout and colours as well as
 * subject/body, none of it necessarily saved — so a draft can be tested
 * before committing to it, and what lands in the inbox is what the preview
 * beside the button is showing. */
export async function sendTestEmailAction(
  brand: Brand,
  _prevState: SendTestEmailState,
  formData: FormData,
): Promise<SendTestEmailState> {
  const to = emptyToNull(formData.get('to'));
  if (!to) return { error: 'Enter an email address.' };

  const elements = readBrandElements(formData);
  const emailReceiptLayout = readChoice(formData, 'emailReceiptLayout', EMAIL_RECEIPT_LAYOUTS);
  if (!elements || !emailReceiptLayout) return { error: BRANDING_FORM_ERROR };

  const emailReceiptSubject = emptyToNull(formData.get('emailReceiptSubject'));
  const emailReceiptBody = emptyToNull(formData.get('emailReceiptBody'));
  if (!emailReceiptSubject || !emailReceiptBody) {
    return { error: 'Subject and body are required.' };
  }

  try {
    await sendEmailReceiptTest(brand.id, {
      ...elements,
      to,
      emailReceiptLayout,
      emailReceiptSubject,
      emailReceiptBody,
    });
  } catch (error) {
    return { error: describeActionError(error, 'Could not send the test email.') };
  }

  return { success: true };
}

export interface InvoicePdfState {
  readonly error?: string;
  readonly success?: boolean;
  /** The save committed, but something alongside it did not — today only a
   * failed logo upload. Shown as a caution, not as a failure. */
  readonly warning?: string;
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
  const elements = readBrandElements(formData);
  const invoicePdfLayout = readChoice(formData, 'invoicePdfLayout', INVOICE_PDF_LAYOUTS);
  const paymentTerms = readChoice(formData, 'paymentTerms', INVOICE_PDF_PAYMENT_TERMS);
  if (!elements || !invoicePdfLayout || !paymentTerms) return { error: BRANDING_FORM_ERROR };

  const notes = emptyToNull(formData.get('notes'));
  if (!notes) return { error: 'Notes are required.' };

  try {
    await updateInvoicePdfSettings(brand.id, {
      ...elements,
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

  const logoError = await saveLogo(brand.id, formData);

  revalidatePath('/brand-settings');
  return logoError ? { success: true, warning: logoError } : { success: true };
}
