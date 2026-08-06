import type { ReactNode } from 'react';

/**
 * The page frame for everything inside the admin shell.
 *
 * One definition rather than eleven: these pages previously each carried their
 * own `mx-auto max-w-*` across four different widths, so the same app changed
 * column width as you navigated, and adjusting the layout meant finding every
 * copy.
 *
 * Full width by default — the shell already constrains the reading area by
 * taking the sidebar out of it, and tables and dashboards have real content to
 * fill the rest. `narrow` is kept for the few single-column forms where a long
 * measure genuinely hurts: a text input stretched across a 27-inch monitor is
 * harder to use, not easier.
 */
export function PageContainer({
  children,
  narrow = false,
  className = '',
}: {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <main
      className={`w-full px-6 py-10 sm:px-10 ${narrow ? 'mx-auto max-w-2xl' : ''} ${className}`.trim()}
    >
      {children}
    </main>
  );
}
