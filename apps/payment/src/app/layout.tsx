import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pay invoice',
  // The page is not indexable and reveals no brand until a valid token
  // resolves to one.
  robots: { index: false, follow: false },
};

/**
 * Reading the nonce here (not just setting it in middleware) is the other
 * half of the CSP contract in middleware.ts: Next only threads a nonce onto
 * its own generated script tags — the inline bootstrap script hydration
 * itself depends on — when a Server Component up the tree actually calls
 * `headers()` to read it. Skipped, `'strict-dynamic'` still applies (which
 * makes browsers ignore the `'self'` fallback), so those scripts end up with
 * no valid nonce at all: CSP silently blocks them, React never hydrates, and
 * every button on every page becomes inert with no visible error.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();

  return (
    <html lang="en">
      {/* See apps/admin/src/app/layout.tsx for why this is on <body>: browser
       * extensions inject attributes here before React hydrates, and the
       * server HTML cannot contain them. Scoped to this element's own
       * attributes, so a genuine mismatch inside the payment flow is still
       * reported — which matters more here than anywhere else in the system. */}
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
