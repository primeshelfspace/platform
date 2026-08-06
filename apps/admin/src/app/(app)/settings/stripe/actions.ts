'use server';

import { redirect } from 'next/navigation';
import { ApiError, disconnectStripe } from '@/lib/api';

export interface StripeFormState {
  readonly error?: string;
}

/**
 * Connecting is a plain link to the API rather than an action — the API answers
 * with a redirect to Stripe's consent screen, which the browser has to follow
 * itself. Disconnecting is the only side effect this screen still owns.
 */
export async function disconnectStripeAction(
  _prevState: StripeFormState,
  formData: FormData,
): Promise<StripeFormState> {
  const brandId = formData.get('brandId');
  if (typeof brandId !== 'string' || !brandId) return { error: 'No brand selected.' };

  try {
    await disconnectStripe(brandId);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return {
      error: error instanceof Error ? error.message : 'Could not disconnect this Stripe account.',
    };
  }

  redirect(`/settings/integrations?tab=payments&brandId=${brandId}&stripeDisconnected=1`);
}
