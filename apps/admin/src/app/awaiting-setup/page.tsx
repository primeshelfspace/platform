import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireOnboardingStep } from '@/lib/onboarding';
import { LogoutButton } from './logout-button';

export const metadata: Metadata = { title: 'Setup In Progress — Prime Shelf Space Inc.' };
export const dynamic = 'force-dynamic';

/**
 * Where a signed-in user lands when their organisation has not finished
 * onboarding and their role cannot finish it for them (FRS-001 §3.3 grants
 * BRANDS WRITE to Owner and Merchant Admin only).
 *
 * Without this page such a user is redirected to a form, refused by the API,
 * and bounced back — an unbreakable loop with no explanation. This says what
 * is actually happening and offers the only two things they can do about it:
 * wait, or sign out.
 */
export default async function AwaitingSetupPage() {
  const user = await requireOnboardingStep('awaiting-setup');
  if (!user) redirect('/');

  return (
    <main className="flex min-h-screen items-center bg-white px-6 py-16">
      <div className="mx-auto w-full max-w-[560px] text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A]">
          Your organisation is still being set up
        </h1>
        <p className="mt-3 text-base text-[#64748B]">
          Signed in as <span className="font-medium text-[#0F172A]">{user.email}</span>. Your
          account is active, but an owner or administrator still needs to finish setting up your
          organisation&rsquo;s brands before there is anything here for you to work on.
        </p>
        <p className="mt-3 text-sm text-[#64748B]">
          Ask whoever administers your account to complete setup, then sign in again.
        </p>
        <div className="mt-8">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
