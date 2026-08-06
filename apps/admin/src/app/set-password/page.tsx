import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOGIN_PATH, readSessionToken, safeReturnPath } from '@/lib/session';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = { title: 'Set Your Password — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * FR-AUTH-007/021. Reached either by (app)/layout.tsx redirecting an INVITED
 * user off the temporary password they signed in with, or directly if someone
 * types the URL — either way it needs its own session check, since it sits
 * outside the (app) route group and so is not covered by that layout's gate.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; token?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.next);
  const token = params.token;

  // Two legitimate ways in. An emailed link carries a one-time token and is
  // the whole point of the signup flow, so it must work with no session at
  // all; a signed-in user changing their password carries a session and no
  // token. Only someone with neither is sent to sign in.
  if (!token && !(await readSessionToken())) {
    redirect(`${LOGIN_PATH}?next=${encodeURIComponent('/set-password')}`);
  }

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Set Your Password
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Create a strong password to secure your account. This is required before you can
            continue.
          </p>
        </div>

        <SetPasswordForm returnTo={returnTo} token={token} />
      </div>
    </main>
  );
}
