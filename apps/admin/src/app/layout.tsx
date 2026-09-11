import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from '@fenwick/ui/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prime Shelf Space Inc.',
  description: 'Multi-brand invoicing and payment administration.',
};

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-jakarta',
});

/**
 * Document shell only. The admin chrome — sidebar, brand switcher, sign-out —
 * lives in (app)/layout.tsx, because /login must render without any of it and
 * without being gated by the session check that layout performs.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
       * suppressHydrationWarning is on <body> specifically because browser
       * extensions inject attributes into it before React hydrates —
       * Grammarly adds data-new-gr-c-s-check-loaded and data-gr-ext-installed,
       * password managers and translators add their own. The server HTML
       * cannot possibly contain them, so React reports a mismatch for markup
       * that is not ours and that we cannot control.
       *
       * It suppresses the warning for THIS element's attributes only, one
       * level deep — children still hydrate strictly, so a real mismatch
       * inside the app is still reported. That narrowness is why this is the
       * right tool here rather than a blanket silencing.
       */}
      <body className={`min-h-full ${plusJakartaSans.variable}`} suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
