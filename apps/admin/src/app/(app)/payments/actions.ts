'use server';

import { revalidatePath } from 'next/cache';
import {
  approveCheckSubmission,
  getCheckSubmission,
  rejectCheckSubmission,
  type CheckSubmissionDetail,
  type ReviewCheckSubmissionInput,
} from '@/lib/api';
import { describeActionError } from '@/lib/form';

export type ActionResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export async function getCheckSubmissionDetailAction(
  brandId: string,
  id: string,
): Promise<ActionResult<CheckSubmissionDetail>> {
  try {
    const data = await getCheckSubmission(brandId, id);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not load this check.') };
  }
}

export async function approveCheckSubmissionAction(
  brandId: string,
  id: string,
  input: ReviewCheckSubmissionInput,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await approveCheckSubmission(brandId, id, input);
    revalidatePath('/payments');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not approve this check.') };
  }
}

export async function rejectCheckSubmissionAction(
  brandId: string,
  id: string,
  input: ReviewCheckSubmissionInput,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await rejectCheckSubmission(brandId, id, input);
    revalidatePath('/payments');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not reject this check.') };
  }
}
