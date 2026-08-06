/**
 * The one toggle in this app.
 *
 * There were two: a `role="switch"` button here, and a separately styled raw
 * checkbox inside the payment-methods form. They were different sizes, so the
 * same control looked like two different controls on two screens.
 *
 * Built on a visually-hidden checkbox rather than a button, because that is
 * what the two call sites between them actually need: native checked
 * semantics for screen readers, label-click activation for free, and — the
 * part a button cannot do — a value that appears in FormData when `name` is
 * set, which is how the payment-methods form submits.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  name,
  id,
  disabled = false,
  layout = 'inline',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  /** Secondary line under the label. Only meaningful in the 'row' layout. */
  hint?: string;
  /** Submits with the form when present. Omit for state the parent owns. */
  name?: string;
  id?: string;
  disabled?: boolean;
  /**
   * 'inline' — switch first, label beside it. For a single question inside a
   * form section ("Same as Mailing address").
   * 'row'    — label and hint left, switch right, separated by a rule. For a
   * list of independent settings.
   */
  layout?: 'inline' | 'row';
}) {
  const control = (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        id={id}
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        // `peer` drives the styling below; sr-only keeps it operable and
        // announced while invisible. An unchecked box is simply absent from
        // FormData, which is how the actions read "false".
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="h-5 w-9 rounded-full bg-[#D1D5DB] transition-colors
                   peer-checked:bg-black peer-disabled:opacity-50
                   peer-focus-visible:ring-2 peer-focus-visible:ring-slate-900
                   peer-focus-visible:ring-offset-1"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow
                   transition-transform peer-checked:translate-x-4 peer-disabled:opacity-70"
      />
    </span>
  );

  if (layout === 'row') {
    return (
      <label
        className={`flex items-start justify-between gap-4 border-b border-border py-3 last:border-0 ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <span>
          <span className="block text-sm font-medium text-ink-strong">{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}
        </span>
        <span className="flex shrink-0 items-center pt-0.5">{control}</span>
      </label>
    );
  }

  return (
    <label
      className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {control}
      <span className="text-sm text-[#0F172A]">{label}</span>
    </label>
  );
}
