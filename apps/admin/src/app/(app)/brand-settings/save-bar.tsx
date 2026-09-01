'use client';

/**
 * The Save / Discard bar for Brand Settings.
 *
 * It sits at the TOP of the editor and is always on screen, which is a
 * deliberate reversal of what was here before: a bar rendered only when
 * dirty, `sticky bottom-0`, as the last element on the page. That never
 * stuck to anything — sticky needs content below it inside the same
 * containing block to hold it against the viewport, and there was none, so
 * the bar simply sat at the bottom of a preview column a thousand pixels
 * tall. A merchant who changed a setting saw no way to save it without
 * scrolling to the end of the page to discover one, and no way at all to
 * tell whether their change had been saved already.
 *
 * So: always rendered, pinned to the top of the scroll container (see
 * admin-shell's overflow-y-auto wrapper — `top-0` is the top of that, just
 * under the app header), and it says which state it is in rather than
 * relying on its own presence to communicate that.
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
  return (
    <div
      className="sticky top-0 z-20 -mx-6 mb-2 flex items-center justify-between gap-3 border-b
                 border-[#E5E7EB] bg-surface px-6 py-3 sm:-mx-10 sm:px-10"
    >
      <p className="text-sm text-ink-muted" aria-live="polite">
        {pending ? 'Saving…' : dirty ? 'You have unsaved changes.' : 'All changes saved.'}
      </p>

      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty || pending}
          className="rounded-[10px] border border-[#D4D4D4] bg-white px-5 py-2.5 text-sm font-bold
                     text-[#0F172A] transition-colors hover:bg-neutral-50
                     disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          Discard
        </button>
        <button
          type="submit"
          disabled={!dirty || pending}
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
