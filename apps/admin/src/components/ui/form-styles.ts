/**
 * Shared Tailwind class strings for form fields.
 *
 * This app has two visual systems for inputs: the design-token one
 * (border-border, bg-surface, text-ink-strong — see @fenwick/shared/tokens),
 * and an older raw-hex one that most of the admin app's forms still use.
 * Unifying the two is a design decision, not a mechanical dedup, so this file
 * only consolidates exact, verified duplicates — it does not migrate anyone
 * from one system to the other.
 *
 * Within the raw-hex system, the red "invalid" border turned out to be
 * genuinely universal (byte-identical across every field, select and auth
 * input checked), but the "valid" border comes in two shades that are each
 * consistently used by their own group of files — not obviously a mistake,
 * so both are kept rather than picking one arbitrarily.
 */

/** Every raw-hex field's invalid-state border, with no exceptions found:
 * add-customer-modal, company-details-form, brand-details-form's Select,
 * login, signup, set-password, and the multi-brand onboarding form. */
export const FIELD_INVALID_BORDER =
  'border-red-400 focus:border-red-500 focus-visible:ring-red-500';

/** #D4D4D4 valid-state border — add-customer-modal, company-details-form,
 * and the shared Select component. */
export const FIELD_VALID_BORDER_PRIMARY =
  'border-[#D4D4D4] focus:border-slate-900 focus-visible:ring-slate-900';

/** #D1D5DB valid-state border — login, signup, set-password, and the
 * multi-brand onboarding form. */
export const FIELD_VALID_BORDER_SECONDARY =
  'border-[#D1D5DB] focus:border-slate-900 focus-visible:ring-slate-900';

/** add-customer-modal.tsx and company-details-form.tsx were carrying
 * byte-identical copies of both of these. */
export const VALIDATED_FIELD_INPUT_CLASS =
  'w-full h-10 rounded-lg border bg-white px-4 text-base text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors disabled:bg-slate-50 disabled:text-slate-400';
export const VALIDATED_FIELD_LABEL_CLASS = 'mb-2 block text-sm font-bold text-[#0F172A]';

/** add-brand-modal.tsx and brand-details-form.tsx: no error state, so the
 * border colour is baked into inputClass rather than split out. */
export const STATIC_FIELD_INPUT_CLASS =
  'w-full h-10 rounded-lg border border-[#D4D4D4] bg-white px-4 text-base text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 transition-colors';
export const STATIC_FIELD_LABEL_CLASS = 'mb-1.5 block text-sm font-bold text-[#0F172A]';

/** Opt-in smaller sizing for the same raw-hex inputs above — mirrors
 * Select's own `compact` variant (see select.tsx), for forms with enough
 * fields that the default h-10 / text-base pushes the page past one
 * screen's height (brand-details-form). */
export const COMPACT_FIELD_INPUT_CLASS =
  'w-full h-9 rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 transition-colors';

/** customer-form.tsx and invoice-form.tsx (the design-token family, not the
 * raw-hex one above) were carrying byte-identical copies of both of these. */
export const TOKEN_FIELD_INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-strong';
export const TOKEN_FIELD_LABEL_CLASS = 'mb-1 block text-xs font-medium text-ink-muted';
