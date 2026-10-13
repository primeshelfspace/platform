'use server';

import { redirect } from 'next/navigation';
import { ApiError, chooseBrandStructure } from '@/lib/api';

export interface BrandStructureState {
  readonly error?: string;
}

const VALID_STRUCTURES = new Set(['SINGLE', 'MULTI']);

export async function chooseBrandStructureAction(
  _prevState: BrandStructureState,
  formData: FormData,
): Promise<BrandStructureState> {
  const choice = String(formData.get('brandStructure') ?? '');
  if (!VALID_STRUCTURES.has(choice)) {
    return { error: 'Select a brand structure to continue.' };
  }

  let result;
  try {
    result = await chooseBrandStructure(choice as 'SINGLE' | 'MULTI');
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not save this choice.' };
  }

  // SINGLE returns the one brand it just created from the staged company
  // details; MULTI returns null and hands off to brand-by-brand setup. The id
  // travels in the query string rather than the name — /brands/created looks
  // the brand up for itself so it always shows the real logo and can't be
  // made to render arbitrary text someone typed into the URL.
  if (result.brand) {
    redirect(`/brands/created?id=${result.brand.id}`);
  }
  redirect('/brands/multi');
}
