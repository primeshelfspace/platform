'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * The thin progress bar across the top of the admin app.
 *
 * Every page in here is `force-dynamic` and fetches from the API on the
 * server, so a navigation can sit for a noticeable moment with nothing on
 * screen changing. Without feedback that reads as a dead click, and people
 * click again.
 *
 * Written against the DOM rather than a router event, because the App Router
 * exposes no navigation-start hook, and rather than a package, because the one
 * dependency this saves is not worth the bundle. It starts on a real
 * same-origin link click and ends when the route actually changes — with a
 * timeout as a backstop, since a click that never completes a navigation
 * (a refused route, an error boundary) must not leave the bar running forever.
 *
 * Deliberately not started on form submit: server actions that return a
 * validation error never navigate, so the bar would hang. Those already show
 * their own pending state on the submit button.
 */
const SAFETY_TIMEOUT_MS = 10_000;

export function TopProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  // The route changed, so whatever was loading has arrived.
  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Anything the browser will not treat as a plain in-app navigation:
      // modified clicks open a new tab, and a prevented click was handled.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      // Navigating to where you already are renders nothing new, so there is
      // nothing to wait for — and the effect above would never fire to clear it.
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search
      ) {
        return;
      }

      setActive(true);
    }

    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent"
    >
      {/* Indeterminate: it eases toward the right and never reaches it, because
          the real duration is unknown and a bar that completes early then waits
          is worse than one that is honestly still moving. */}
      <div className="h-full w-full origin-left animate-[top-progress_10s_cubic-bezier(0.1,0.9,0.2,1)_forwards] bg-brand" />
    </div>
  );
}
