'use server';

import {
  createCustomer,
  getCustomer,
  listInvoices,
  updateCustomer,
  type Customer,
  type CustomerAddress,
  type CustomerFormInput,
  type CustomerWithContacts,
  type Invoice,
} from '@/lib/api';
import { addressFromForm, describeActionError, emptyToNull } from '@/lib/form';

export interface CreateCustomerState {
  readonly error?: string;
  readonly customer?: Customer;
}

/**
 * The Add Customer modal's action. A sibling of new/actions.ts's
 * createCustomerAction, not a replacement for it — that one redirects to a
 * full page and is kept for direct navigation to /customers/new. This one
 * never redirects: the modal stays mounted, reads `customer` off the
 * returned state to close itself and refresh the table, and re-renders in
 * place on `error` so the user's input survives a validation failure.
 */
export async function createCustomerAction(
  brandId: string,
  _prevState: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const type = formData.get('type') === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS';
  const companyName = emptyToNull(formData.get('companyName'));
  const firstName = emptyToNull(formData.get('firstName'));
  const lastName = emptyToNull(formData.get('lastName'));

  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName = companyName ?? (joinedName || null);

  if (!displayName) {
    return {
      error: type === 'BUSINESS' ? 'Enter a company name.' : 'Enter a first or last name.',
    };
  }

  const billingAddress = addressFromForm(formData, 'billing');
  const shippingAddress: CustomerAddress | null =
    formData.get('sameAsBilling') === 'on' ? billingAddress : addressFromForm(formData, 'shipping');

  const input: CustomerFormInput = {
    type,
    salutation: null,
    firstName,
    lastName,
    companyName,
    displayName,
    email: emptyToNull(formData.get('email')),
    phone: emptyToNull(formData.get('phone')),
    billingAddress,
    shippingAddress,
  };

  try {
    const customer = await createCustomer(brandId, input);
    return { customer };
  } catch (error) {
    return { error: describeActionError(error, 'Could not create this customer.') };
  }
}

export interface UpdateCustomerState {
  readonly error?: string;
  readonly customer?: Customer;
}

/**
 * The Edit Details modal's action — a sibling of createCustomerAction above,
 * same field parsing/derivation, PATCH instead of POST. Kept as its own
 * independent function rather than sharing the parsing logic, same
 * duplicate-rather-than-couple reasoning this file's other action already
 * follows: each stays safe to change without touching the other.
 */
export async function updateCustomerAction(
  brandId: string,
  customerId: string,
  _prevState: UpdateCustomerState,
  formData: FormData,
): Promise<UpdateCustomerState> {
  const type = formData.get('type') === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS';
  const companyName = emptyToNull(formData.get('companyName'));
  const firstName = emptyToNull(formData.get('firstName'));
  const lastName = emptyToNull(formData.get('lastName'));

  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName = companyName ?? (joinedName || null);

  if (!displayName) {
    return {
      error: type === 'BUSINESS' ? 'Enter a company name.' : 'Enter a first or last name.',
    };
  }

  const billingAddress = addressFromForm(formData, 'billing');
  const shippingAddress: CustomerAddress | null =
    formData.get('sameAsBilling') === 'on' ? billingAddress : addressFromForm(formData, 'shipping');

  const input: CustomerFormInput = {
    type,
    // Not collected by this form, same as the Add Customer modal it mirrors
    // — but unlike a fresh create, an edit must not silently null out a
    // salutation the customer already had (e.g. from a Zoho sync), so this
    // round-trips whatever the form was given rather than hardcoding null.
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

  try {
    const customer = await updateCustomer(brandId, customerId, input);
    return { customer };
  } catch (error) {
    return { error: describeActionError(error, 'Could not save these changes.') };
  }
}

export interface CustomerDetailResult {
  readonly customer?: CustomerWithContacts;
  readonly invoices?: Invoice[];
  readonly error?: string;
}

/**
 * Backs the customer detail slide-over. api.ts's fetchers are server-only
 * (they read the session cookie via next/headers), so the client component
 * that owns the drawer's open/loading state calls this action directly
 * (not through a `<form>`) rather than calling getCustomer/listInvoices
 * itself.
 *
 * The two calls are independent — invoices don't need the customer object or
 * vice versa — so they run together. A failed invoice fetch still lets the
 * drawer show the customer's own details; the table just reports its own
 * error instead of the whole drawer refusing to open.
 */
export async function getCustomerDetailAction(
  brandId: string,
  customerId: string,
): Promise<CustomerDetailResult> {
  const [customerOutcome, invoicesOutcome] = await Promise.allSettled([
    getCustomer(brandId, customerId),
    listInvoices(brandId, { customerId, pageSize: 50 }),
  ]);

  if (customerOutcome.status === 'rejected') {
    return { error: describeActionError(customerOutcome.reason, 'Could not load this customer.') };
  }

  return {
    customer: customerOutcome.value,
    invoices: invoicesOutcome.status === 'fulfilled' ? invoicesOutcome.value.data : [],
  };
}
