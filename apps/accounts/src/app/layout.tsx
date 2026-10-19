import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from '@platform/ui/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Accounts',
  description: 'Sign in, team, brands, locations and billing for every product.',
};

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-jakarta',
});

/**
 * Document shell only. The signed-in chrome lives in (app)/layout.tsx, so the
 * sign-in pages render without it. suppressHydrationWarning on <body> is for
 * attributes browser extensions inject (see the invoicing app's layout).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`min-h-full ${plusJakartaSans.variable}`} suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
