'use client';

import { logoutAction } from '@/lib/logout-action';

/** The only action available on this page — the same server action the
 * signed-in shell uses, not a second sign-out path. */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-strong hover:bg-surface-muted"
      >
        Sign out
      </button>
    </form>
  );
}
