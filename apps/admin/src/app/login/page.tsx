import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/api';
import { readSessionToken, safeReturnPath } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * The one route outside the (app) group, so it renders without the admin shell —
 * a sidebar full of links you cannot follow is not a sign-in page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.next);

  // Someone already signed in has no business here. Verified against the API
  // rather than trusted from the cookie's presence — a stale cookie would
  // otherwise bounce them into the app and straight back out again.
  if (await readSessionToken()) {
    const stillValid = await getCurrentUser().then(
      () => true,
      () => false,
    );
    if (stillValid) redirect(returnTo);
  }

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Welcome Back
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Sign in with the temporary password provided to you.
          </p>
        </div>

        {params.expired && (
          <p
            role="status"
            className="mb-5 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            Your session ended. Sign in again to continue.
          </p>
        )}

        <LoginForm returnTo={returnTo} />

        <p className="mt-8 text-center text-sm text-[#64748B]">
          Don&rsquo;t have an account?{' '}
          <Link href="/signup" className="font-semibold text-[#0F172A] underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
