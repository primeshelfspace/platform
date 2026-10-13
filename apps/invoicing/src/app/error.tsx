'use client';

import { useEffect } from 'react';
import { LogoMark } from '@/components/logo-mark';

/**
 * Root error boundary. Without this, any uncaught exception from a server
 * component or action — an upstream 500, a dropped connection — falls
 * through to Next's bare default error page, which is not something a
 * client demo should ever show. This only catches what nothing else already
 * handles: pages like login, set-password and every onboarding step already
 * wrap their own API calls in try/catch and turn a failure into inline copy,
 * so this is the backstop underneath that, not a replacement for it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The full error still reaches the browser console for whoever is
    // debugging — this boundary only changes what the user sees.
    // eslint-disable-next-line no-console
    console.error('Unhandled error in admin app:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16">
      <div className="w-full max-w-[440px] text-center">
        <LogoMark size={48} />
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-[#0F172A]">
          Something went wrong
        </h1>
        <p className="mt-2 text-base text-[#64748B]">
          That didn&rsquo;t go through. This is usually temporary — try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 w-full rounded-[10px] bg-black px-4 py-3.5 text-base font-bold text-white
                     transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-black focus-visible:ring-offset-2"
        >
          Try Again
        </button>
      </div>
    </main>
  );
}
