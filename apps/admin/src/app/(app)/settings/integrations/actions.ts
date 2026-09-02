'use server';

import {
  connectAuthorizeNet,
  connectPaymentGateway,
  createZohoSandbox,
  deleteZohoSandbox,
  disconnectPaymentGateway,
  disconnectZoho,
  getZohoSandboxChanges,
  listZohoSandboxes,
  pushZohoSandboxToProduction,
  rebuildZohoSandbox,
  setZohoSandboxActive,
  updatePaymentMethodSettings,
  updateZohoSyncSettings,
  validateZohoSandboxPush,
  type AuthorizeNetConnectInput,
  type PaymentGatewayProvider,
  type PaymentMethodSettings,
  type ZohoConnectionStatus,
  type ZohoSandbox,
  type ZohoSandboxChange,
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

// --- Zoho Books Sandbox ------------------------------------------------------

export async function listZohoSandboxesAction(
  brandId: string,
): Promise<ActionResult<ZohoSandbox[]>> {
  try {
    return { ok: true, data: await listZohoSandboxes(brandId) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not load sandboxes.') };
  }
}

export async function createZohoSandboxAction(
  brandId: string,
  name?: string,
): Promise<ActionResult<ZohoSandbox>> {
  try {
    return { ok: true, data: await createZohoSandbox(brandId, name) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not create a sandbox.') };
  }
}

/** Behind a confirmation dialog in the panel — deletes the sandbox itself,
 * not the brand's production org. */
export async function deleteZohoSandboxAction(
  brandId: string,
  sandboxId: string,
): Promise<ActionResult<{ ok: true }>> {
  try {
    return { ok: true, data: await deleteZohoSandbox(brandId, sandboxId) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not delete this sandbox.') };
  }
}

export async function setZohoSandboxActiveAction(
  brandId: string,
  sandboxId: string,
  active: boolean,
): Promise<ActionResult<ZohoSandbox>> {
  try {
    return { ok: true, data: await setZohoSandboxActive(brandId, sandboxId, active) };
  } catch (error) {
    return {
      ok: false,
      error: describeActionError(
        error,
        `Could not ${active ? 'activate' : 'deactivate'} this sandbox.`,
      ),
    };
  }
}

export async function rebuildZohoSandboxAction(
  brandId: string,
  sandboxId: string,
): Promise<ActionResult<ZohoSandbox>> {
  try {
    return { ok: true, data: await rebuildZohoSandbox(brandId, sandboxId) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not rebuild this sandbox.') };
  }
}

export async function getZohoSandboxChangesAction(
  brandId: string,
  sandboxId: string,
  target: 'sandbox' | 'production',
): Promise<ActionResult<ZohoSandboxChange[]>> {
  try {
    return { ok: true, data: await getZohoSandboxChanges(brandId, sandboxId, target) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not load changes.') };
  }
}

/** The first of the two-step push flow — read-only, safe to call freely. */
export async function validateZohoSandboxPushAction(
  brandId: string,
  sandboxId: string,
): Promise<ActionResult<unknown>> {
  try {
    return { ok: true, data: await validateZohoSandboxPush(brandId, sandboxId) };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not validate this push.') };
  }
}

/**
 * The second step — only ever called from behind the panel's explicit
 * "Push to Production" confirmation dialog, itself only reachable after a
 * successful validate. This is the one action in the whole Sandbox section
 * that changes the brand's real, live Zoho org.
 */
export async function pushZohoSandboxToProductionAction(
  brandId: string,
  sandboxId: string,
): Promise<ActionResult<unknown>> {
  try {
    return { ok: true, data: await pushZohoSandboxToProduction(brandId, sandboxId) };
  } catch (error) {
    return {
      ok: false,
      error: describeActionError(error, 'Could not push changes to production.'),
    };
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
