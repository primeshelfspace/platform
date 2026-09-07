'use client';

import { useEffect } from 'react';
import { toast } from '@fenwick/ui/toast';

interface FormStatus {
  error?: string | null;
  success?: string | boolean | null;
  warning?: string | null;
}

/**
 * Reports a `useActionState` result through the app-wide toast instead of
 * each form rendering its own inline error/success/warning banner. `status`
 * is expected to be a fresh object per action dispatch (as `useActionState`
 * returns), which is what makes depending on it directly — rather than on its
 * field values — fire exactly once per submission.
 *
 * `successMessage` covers the common case of `success` being a bare `true`
 * rather than a string.
 */
export function useFormStatusToast(status: FormStatus, successMessage = 'Saved.'): void {
  useEffect(() => {
    if (status.error) {
      toast.error(status.error);
    } else if (status.warning) {
      toast.warning(status.warning);
    } else if (status.success) {
      toast.success(typeof status.success === 'string' ? status.success : successMessage);
    }
  }, [status, successMessage]);
}
