import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/logo-mark';

export const metadata: Metadata = { title: 'Check your inbox — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * Shown straight after signup. Purely informational — there is nothing to do
 * here but read, because the next step happens in the recipient's inbox.
 *
 * The address is echoed from the query string for recognition ("did I typo
 * it?") and nothing is decided from it. It is rendered as text, never as a
 * link or a redirect target.
 */
export default async function CheckInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[600px] text-center">
        <LogoMark size={56} />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
          Check your inbox
        </h1>
        <p className="mt-3 text-base text-[#64748B] sm:text-[17px]">
          {email ? (
            <>
              We&rsquo;ve sent an email to{' '}
              <span className="font-semibold text-[#0F172A]">{email}</span> with a link to set your
              password.
            </>
          ) : (
            <>We&rsquo;ve sent you an email with a link to set your password.</>
          )}
        </p>

        <div className="mt-8 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4 text-left">
          <p className="text-sm text-[#475569]">
            The link can be used once and expires in 24 hours. If it doesn&rsquo;t arrive within a
            few minutes, check your spam folder — or{' '}
            <Link href="/signup" className="font-semibold text-[#0F172A] underline">
              try signing up again
            </Link>
            .
          </p>
        </div>

        <p className="mt-8 text-sm text-[#64748B]">
          Already set your password?{' '}
          <Link href="/login" className="font-semibold text-[#0F172A] underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
