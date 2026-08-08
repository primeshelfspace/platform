import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo-mark';
import { getCurrentUser } from '@/lib/api';
import { readSessionToken } from '@/lib/session';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create your account — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * FR-ONB step 0, and the only page that creates a tenant. Sits outside the
 * (app) group so it renders without the admin shell, for the same reason
 * /login does.
 *
 * Someone already signed in has no business here — verified against the API
 * rather than trusted from the cookie's presence, so a stale cookie does not
 * bounce them into the app and straight back out.
 */
export default async function SignupPage() {
  if (await readSessionToken()) {
    const stillValid = await getCurrentUser().then(
      () => true,
      () => false,
    );
    if (stillValid) redirect('/');
  }

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-10 text-center">
          <LogoMark size={96} />
          <h1 className="mt-6 text-[32px] font-bold tracking-tight text-[#0F172A] sm:text-[40px]">
            Create Your Account
          </h1>
          <p className="mt-3 text-[17px] text-[#64748B]">Create your account to get started.</p>
        </div>

        <SignupForm />

        <p className="mt-8 text-center text-sm text-[#64748B]">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-[#0F172A] underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
