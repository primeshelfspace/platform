'use client';

/**
 * The Save / Discard bar for Brand Settings.
 *
 * Rendered only while there's something to act on — dirty, or a save
 * in flight — and gone entirely once a save lands and nothing is dirty. A
 * bar offering to Save/Discard when there is nothing to save or discard has
 * nothing to say; disabling its buttons instead of removing it just leaves
 * a dead control on screen.
 *
 * Rendered as the LAST element inside its `<form>`, `sticky bottom-4`: as
 * the last child, its natural (unstuck) position is at the very end of the
 * form's content, which is exactly what lets sticky hold it against the
 * viewport bottom the rest of the time. A floating card (rounded on every
 * corner, its own border and shadow) rather than a full-bleed strip, so it
 * reads as a control surface hovering over the content rather than another
 * section of the page.
 */
export function SaveBar({
  dirty,
  pending,
  onDiscard,
}: {
  dirty: boolean;
  pending: boolean;
  onDiscard: () => void;
}) {
  if (!dirty && !pending) return null;

  return (
    <div
      className="sticky bottom-4 z-20 mt-6 flex items-center justify-between gap-3 rounded-xl
                 border border-[#E5E7EB] bg-surface px-6 py-3 shadow-lg"
    >
      <p className="text-sm text-ink-muted" aria-live="polite">
        {pending ? 'Saving…' : 'You have unsaved changes.'}
      </p>

      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={pending}
          className="rounded-[10px] border border-[#D4D4D4] bg-white px-5 py-2.5 text-sm font-bold
                     text-[#0F172A] transition-colors hover:bg-neutral-50
                     disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          Discard
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] bg-black px-5 py-2.5 text-sm font-bold text-white transition-colors
                     hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
