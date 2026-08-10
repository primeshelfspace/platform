'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Brand } from '@/lib/api';
import { addBrandAction, type AddBrandState } from '@/app/(app)/brands/actions';

const initialState: AddBrandState = {};

const inputClass =
  'w-full h-10 rounded-lg border border-[#D4D4D4] bg-white px-4 text-base text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 transition-colors';

/**
 * The sidebar's "Add New Brand" flow. Deliberately asks for only a name and
 * an optional logo — same scope as the onboarding multi-brand step — since
 * everything else (business type, currency, timezone) is inherited server
 * side and the rest can be filled in from Brand Setup afterwards.
 *
 * Stays mounted (rendered, but returning null) even while closed so its
 * useActionState instance survives between opens — the alternative,
 * conditionally mounting the whole component, would reset `state` on every
 * close and defeat the success effect below.
 */
export function AddBrandModal({
  open,
  brands,
  onClose,
  onCreated,
}: {
  open: boolean;
  brands: Brand[];
  onClose: () => void;
  onCreated: (brandId: string) => void;
}) {
  const action = addBrandAction.bind(null, brands);
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // A successful create produces a fresh brandId — hand it to the parent
  // (which switches to it and closes this modal) and reset so the next open
  // starts from a blank form rather than the last brand's name.
  useEffect(() => {
    if (!state.brandId) return;
    onCreated(state.brandId);
    formRef.current?.reset();
    setLogoPreview(null);
    // onCreated is provided fresh each render by the parent; only re-run this
    // when a new brandId actually arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.brandId]);

  useEffect(() => {
    if (open) return;
    formRef.current?.reset();
    setLogoPreview(null);
  }, [open]);

  if (!open) return null;

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-brand-heading"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-brand-heading" className="text-lg font-bold text-[#0F172A]">
            Add New Brand
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#64748B] hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form ref={formRef} action={formAction} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#0F172A]">Brand Name</span>
            <input
              name="brandName"
              required
              autoFocus
              placeholder="Enter brand name"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#0F172A]">Logo (optional)</span>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#94A3B8]">
                  <Plus className="h-4 w-4" aria-hidden />
                </span>
              )}
              <input
                type="file"
                name="brandLogo"
                accept="image/jpeg,image/png,image/svg+xml"
                onChange={handleLogoChange}
                className="text-sm text-[#64748B]"
              />
            </div>
          </label>

          {state.error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#D4D4D4] bg-white px-4 py-2.5 text-sm font-bold
                         text-[#0F172A] transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white transition-colors
                         hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]"
            >
              {pending ? 'Creating…' : 'Create Brand'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
