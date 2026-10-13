'use server';

import { revalidatePath } from 'next/cache';
import { retrySyncJob } from '@/lib/api';
import { describeActionError } from '@/lib/form';

export type ActionResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** The Needs Attention panel's Retry button — re-enqueues the real sync job
 * (DashboardService.retrySyncJob), not a stub. Revalidates the dashboard so
 * the item disappears once the retry actually clears the failure, rather
 * than optimistically hiding it before the worker has run. */
export async function retrySyncJobAction(jobId: string): Promise<ActionResult<{ queued: true }>> {
  try {
    const result = await retrySyncJob(jobId);
    revalidatePath('/');
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describeActionError(error, 'Could not retry this sync job.') };
  }
}
