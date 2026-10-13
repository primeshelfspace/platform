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
 * Rendered as the LAST element inside its `<form>`, `sticky bottom-0`: as
 * the last child, its natural (unstuck) position is at the very end of the
 * form's content, which is exactly what lets sticky hold it against the
 * viewport bottom the rest of the time. A full-bleed strip flush with the
 * viewport edge (the negative margins cancel PageContainer's own px-6/px-10),
 * not an inset floating card — it reads as a fixed toolbar anchored to the
 * bottom of the screen.
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
      className="sticky bottom-0 z-20 -mx-6 mt-6 flex items-center justify-between gap-3
                 border-t border-[#E5E7EB] bg-surface px-6 py-4 sm:-mx-10"
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
