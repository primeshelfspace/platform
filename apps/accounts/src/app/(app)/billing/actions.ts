'use server';

import { revalidatePath } from 'next/cache';
import { isProduct } from '@platform/platform-contracts';
import { updateSubscription } from '@/lib/api';

export async function setSubscriptionAction(formData: FormData): Promise<void> {
  const product = formData.get('product');
  const status = formData.get('status');
  if (!isProduct(product) || (status !== 'ACTIVE' && status !== 'CANCELLED')) return;
  await updateSubscription(product, status);
  revalidatePath('/', 'layout');
}
