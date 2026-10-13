'use client';

import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every `intervalMs` while the tab is visible and `enabled`
 * is true — pausing in background tabs so hidden pages don't keep hammering
 * the server, and resuming (with an immediate tick) the moment the tab
 * becomes visible again or `enabled` flips back on.
 */
export function useIntervalWhenVisible(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let id: ReturnType<typeof setInterval> | undefined;

    function start() {
      if (id !== undefined) return;
      id = setInterval(() => callbackRef.current(), intervalMs);
    }
    function stop() {
      if (id === undefined) return;
      clearInterval(id);
      id = undefined;
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        callbackRef.current();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
