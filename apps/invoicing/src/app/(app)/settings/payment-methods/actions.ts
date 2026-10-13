'use server';

import { redirect } from 'next/navigation';
import { ApiError, updatePaymentMethodSettings } from '@/lib/api';

export interface ToggleMethodsState {
  readonly error?: string;
}

export async function updatePaymentMethodsAction(
  _prevState: ToggleMethodsState,
  formData: FormData,
): Promise<ToggleMethodsState> {
  const brandId = formData.get('brandId');
  if (typeof brandId !== 'string' || !brandId) return { error: 'No brand selected.' };

  const input = {
    cardEnabled: formData.get('cardEnabled') === 'on',
    applePayEnabled: formData.get('applePayEnabled') === 'on',
    googlePayEnabled: formData.get('googlePayEnabled') === 'on',
    achEnabled: formData.get('achEnabled') === 'on',
    checkEnabled: formData.get('checkEnabled') === 'on',
  };

  try {
    await updatePaymentMethodSettings(brandId, input);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not save these settings.' };
  }

  redirect(`/settings/payment-methods?brandId=${brandId}&saved=1`);
}
