'use client';

import { useEffect, useRef } from 'react';

/**
 * Closes a panel on an outside click or Escape — the one bit of behaviour
 * every dropdown, popover and confirm dialog in this app needs.
 *
 * Previously reimplemented independently in three places (AdminShell, the
 * invoices list's date-range menu, and the Zoho settings panel); the Zoho
 * copy had already drifted to Escape-only, silently losing outside-click on
 * that one dialog while every other dismissable panel kept it.
 */
export function useDismissablePanel<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return ref;
}
