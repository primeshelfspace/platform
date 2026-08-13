import type { Metadata } from 'next';
import { LogoMark } from '@/components/logo-mark';

export const metadata: Metadata = { title: 'Check your inbox — Prime Shelf Space Inc.' };
export const dynamic = 'force-dynamic';

/**
 * Shown straight after signup. Purely informational — there is nothing to do
 * here but read, because the next step happens in the recipient's inbox.
 */
export default function CheckInboxPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[600px] text-center">
        <LogoMark size={56} />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
          Check your inbox
        </h1>
        <p className="mt-3 text-base text-[#64748B] sm:text-[17px]">
          Check your inbox—we have sent you an email with login instructions.
        </p>
      </div>
    </main>
  );
}
