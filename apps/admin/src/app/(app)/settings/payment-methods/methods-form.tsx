'use client';

import { useActionState, useState } from 'react';
import type { PaymentMethodSettings } from '@/lib/api';
import { Toggle } from '@/components/ui/toggle';
import { updatePaymentMethodsAction, type ToggleMethodsState } from './actions';

const initialState: ToggleMethodsState = {};

export function MethodsForm({
  brandId,
  initial,
}: {
  brandId: string;
  initial: PaymentMethodSettings;
}) {
  const [state, formAction, pending] = useActionState(updatePaymentMethodsAction, initialState);
  const [settings, setSettings] = useState(initial);

  function set<K extends keyof PaymentMethodSettings>(key: K, value: boolean) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  const anyEnabled = Object.values(settings).some(Boolean);

  return (
    <form action={formAction}>
      <input type="hidden" name="brandId" value={brandId} />

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <Toggle
          layout="row"
          name="cardEnabled"
          label="Credit & debit card"
          hint="Processed by Stripe when PAYMENT_GATEWAY_DRIVER=stripe (real card charges, test mode with test keys); Numbers Gateway remains blocked pending DEP-01; FakeGateway is the local no-driver-set default."
          checked={settings.cardEnabled}
          onChange={(v) => set('cardEnabled', v)}
        />
        <Toggle
          layout="row"
          name="applePayEnabled"
          label="Apple Pay"
          hint="Also needs Apple domain verification and a merchant identity certificate — turning this on alone does not make the real button appear yet."
          checked={settings.applePayEnabled}
          onChange={(v) => set('applePayEnabled', v)}
        />
        <Toggle
          layout="row"
          name="googlePayEnabled"
          label="Google Pay"
          hint="Also needs a registered Google Pay merchant ID — same caveat as Apple Pay."
          checked={settings.googlePayEnabled}
          onChange={(v) => set('googlePayEnabled', v)}
        />
        <Toggle
          layout="row"
          name="achEnabled"
          label="Bank transfer (ACH)"
          hint="No card fee applies to this method."
          checked={settings.achEnabled}
          onChange={(v) => set('achEnabled', v)}
        />
        <Toggle
          layout="row"
          name="checkEnabled"
          label="Manual check upload"
          hint="Not wired up in the payment app yet — enabling this has no visible effect today."
          checked={settings.checkEnabled}
          onChange={(v) => set('checkEnabled', v)}
        />
      </div>

      {!anyEnabled && (
        <div className="mt-4 rounded-md bg-danger-surface p-3 text-sm text-danger">
          At least one method must stay enabled, or every invoice for this brand becomes unpayable.
        </div>
      )}
      {state.error && (
        <div className="mt-4 rounded-md bg-danger-surface p-3 text-sm text-danger">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !anyEnabled}
        className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
