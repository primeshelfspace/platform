import { redirect } from 'next/navigation';
import { getCurrentUser, type CurrentUser } from '@/lib/api';
import { LOGIN_PATH } from '@/lib/session';
import { AccountsShell } from '@/components/accounts-shell';

/**
 * Every signed-in page. The cookie the middleware saw is not proof of a
 * session, so this asks the API on each render; any failure means sign in
 * again. A user still on a temporary password sets a real one first.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  let user: CurrentUser;
  try {
    user = await getCurrentUser();
  } catch {
    redirect(`${LOGIN_PATH}?expired=1`);
  }
  if (user.mustResetPassword) redirect('/set-password');

  return <AccountsShell user={user}>{children}</AccountsShell>;
}
