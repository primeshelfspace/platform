'use server';

import { redirect } from 'next/navigation';
import { ApiError, createCustomer, type CustomerAddress, type CustomerFormInput } from '@/lib/api';
import { addressFromForm, describeApiError, emptyToNull } from '@/lib/form';

export interface CreateCustomerState {
  readonly error?: string;
}

/**
 * Server Action, invoked directly as the form's action prop — works with
 * useActionState so validation failures render inline instead of hitting the
 * nearest error boundary. Only the success path leaves this function (via
 * redirect, which Next.js implements as a thrown control-flow signal — that
 * is not caught by the try/catch below, by design).
 */
export async function createCustomerAction(
  _prevState: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const brandId = emptyToNull(formData.get('brandId'));
  if (!brandId) return { error: 'No brand selected.' };

  const type = formData.get('type') === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS';
  const companyName = emptyToNull(formData.get('companyName'));
  const firstName = emptyToNull(formData.get('firstName'));
  const lastName = emptyToNull(formData.get('lastName'));

  // FR-CUS-005: default the display name rather than force the user to
  // re-type what they already entered. `.join(' ')` always returns a string
  // (possibly empty), so the empty case is checked explicitly rather than
  // relying on `??`, which only catches null/undefined.
  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName =
    emptyToNull(formData.get('displayName')) ?? companyName ?? (joinedName || null);

  if (!displayName) {
    return { error: 'Enter a company name, a contact name, or a display name.' };
  }
  if (type === 'BUSINESS' && !companyName) {
    return { error: 'A business customer needs a company name.' };
  }
  if (type === 'INDIVIDUAL' && !firstName && !lastName) {
    return { error: 'An individual customer needs a first or last name.' };
  }

  const billingAddress = addressFromForm(formData, 'billing');
  const shippingAddress =
    formData.get('sameAsBilling') === 'on' ? billingAddress : addressFromForm(formData, 'shipping');

  const input: CustomerFormInput = {
    type,
    salutation: emptyToNull(formData.get('salutation')),
    firstName,
    lastName,
    companyName,
    displayName,
    email: emptyToNull(formData.get('email')),
    phone: emptyToNull(formData.get('phone')),
    billingAddress,
    shippingAddress,
  };

  let created;
  try {
    created = await createCustomer(brandId, input);
  } catch (error) {
    if (error instanceof ApiError) return { error: describeApiError(error) };
    return { error: error instanceof Error ? error.message : 'Could not create this customer.' };
  }

  redirect(`/customers?brandId=${brandId}&created=${created.id}`);
}
