'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Backdrop + dialog shell shared by every "Add X" modal in this app.
 *
 * Previously reimplemented independently by AddBrandModal and
 * AddCustomerModal — byte-identical backdrop, dialog card and close-button
 * markup, but only AddCustomerModal implemented Escape-to-close and a Tab
 * focus trap. A keyboard user could dismiss "Add Customer" that way but not
 * "Add Brand" — both get the same behaviour now that there's one
 * implementation instead of two silently drifting apart.
 *
 * Portalled to <body> for the same reason customer-detail-drawer.tsx is: the
 * (app) layout's `.page-transition` wrapper keeps a `transform` applied
 * after its enter animation finishes (fill-mode `both`), which makes it the
 * containing block for any `position: fixed` descendant. Centered on a tall
 * page that mostly went unnoticed here; escaping via a portal is the actual
 * fix rather than something this component should have to compensate for.
 */
export function Modal({
  open,
  onClose,
  titleId,
  title,
  children,
  dialogClassName = 'w-full max-w-[420px]',
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  children: React.ReactNode;
  /** Sizing/overflow varies per modal (a short form vs. a long scrolling one) — everything else does not. */
  dialogClassName?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={`rounded-2xl bg-white p-4 shadow-xl ${dialogClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-bold text-[#0F172A]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#64748B] hover:bg-slate-100 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
