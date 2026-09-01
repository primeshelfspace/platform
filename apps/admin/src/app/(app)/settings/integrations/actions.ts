'use server';

import {
  connectAuthorizeNet,
  connectPaymentGateway,
  disconnectPaymentGateway,
  disconnectZoho,
  updatePaymentMethodSettings,
  updateZohoSyncSettings,
  type AuthorizeNetConnectInput,
  type PaymentGatewayProvider,
  type PaymentMethodSettings,
  type ZohoConnectionStatus,
  type ZohoSyncSettingsPatch,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

export type ActionResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/**
 * Called directly from the client panel's onChange handlers, not bound to a
 * `<form>` — FR-ZHO-030 wants each control to persist itself the moment it
 * changes, and a Server Action is a plain async function whether or not
 * anything ever wires it to `useActionState`.
 */
export async function updateZohoSyncSettingsAction(
  brandId: string,
  patch: ZohoSyncSettingsPatch,
): Promise<ActionResult<ZohoConnectionStatus>> {
  try {
    const status = await updateZohoSyncSettings(brandId, patch);
    return { ok: true, data: status };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not save this setting.') };
  }
}

/** Behind a confirmation dialog in the panel, not a plain click — this ends
 * every push and pull for the brand immediately. */
export async function disconnectZohoAction(brandId: string): Promise<ActionResult<{ ok: true }>> {
  try {
    const result = await disconnectZoho(brandId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not disconnect Zoho Books.') };
  }
}

/** PayPal's "Connect" button on the Payment Gateways list — Stripe and
 * Square instead link straight to their own OAuth redirect, and
 * Authorize.net goes through connectAuthorizeNetAction's credential form, so
 * none of those three ever call this. */
export async function connectPaymentGatewayAction(
  brandId: string,
  provider: Extract<PaymentGatewayProvider, 'PAYPAL'>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const result = await connectPaymentGateway(brandId, provider);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not connect this gateway.') };
  }
}

/** Authorize.net's "Connect" form — verifies the pasted API Login ID and
 * Transaction Key against Authorize.net before anything is stored. */
export async function connectAuthorizeNetAction(
  brandId: string,
  input: AuthorizeNetConnectInput,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const result = await connectAuthorizeNet(brandId, input);
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: describeActionError(error, 'Could not connect Authorize.net with these credentials.'),
    };
  }
}

/** Behind the "Disconnect ⟨gateway⟩?" confirmation dialog, for any of the
 * four gateways — the API dispatches to Stripe's own deauthorisation
 * server-side when provider is STRIPE. */
export async function disconnectPaymentGatewayAction(
  brandId: string,
  provider: PaymentGatewayProvider,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const result = await disconnectPaymentGateway(brandId, provider);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not disconnect this gateway.') };
  }
}

/** Called directly from each Payment Methods toggle's onChange, same
 * immediate-save convention as updateZohoSyncSettingsAction above — the
 * caller sends the full settings object (its own state merged with the one
 * field that changed) since the API's PATCH replaces the whole record. */
export async function updatePaymentMethodSettingsAction(
  brandId: string,
  settings: PaymentMethodSettings,
): Promise<ActionResult<PaymentMethodSettings>> {
  try {
    const result = await updatePaymentMethodSettings(brandId, settings);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not save this setting.') };
  }
}
