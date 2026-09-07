import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo-mark';
import { getCurrentUser } from '@/lib/api';
import { readSessionToken } from '@/lib/session';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password — Prime Shelf Space Inc.' };
export const dynamic = 'force-dynamic';

/**
 * FR-AUTH-005. Sits outside the (app) group, for the same reason /login and
 * /signup do — a signed-in shell has nothing to offer someone who cannot sign
 * in yet.
 *
 * Someone already signed in has no business here — verified against the API
 * rather than trusted from the cookie's presence, so a stale cookie does not
 * bounce them into the app and straight back out.
 */
export default async function ForgotPasswordPage() {
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
        <div className="mb-8 text-center">
          <LogoMark size={56} />
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Reset Your Password
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Enter the email address on your account and we&rsquo;ll send you a link to set a new
            password.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="mt-8 text-center text-sm text-[#64748B]">
          Remembered your password?{' '}
          <Link href="/login" className="font-semibold text-[#0F172A] underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
