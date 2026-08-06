'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import { createBrandsAction, type CreateBrandsState } from './actions';

const initialState: CreateBrandsState = {};

const inputClass =
  'w-full rounded-[8px] border bg-white px-3 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';
const validBorder = 'border-[#D1D5DB] focus:border-slate-900 focus-visible:ring-slate-900';
const invalidBorder = 'border-red-400 focus:border-red-500 focus-visible:ring-red-500';

/** Stable per-row identity so React keeps input state when a row above is
 * removed — indexes as keys would shift every value up by one. */
interface Row {
  readonly key: number;
  name: string;
  logo: File | null;
}

/** A deterministic colour per brand, so the same name always gets the same
 * avatar and the list stays visually distinguishable while it is being built. */
const AVATAR_COLOURS = ['#0F172A', '#166534', '#1D4ED8', '#9A3412', '#6D28D9', '#BE123C'] as const;

function avatarColour(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!;
}

function BrandRow({
  row,
  index,
  showDelete,
  invalid,
  onChangeName,
  onPickLogo,
  onRemove,
}: {
  row: Row;
  index: number;
  showDelete: boolean;
  invalid: boolean;
  onChangeName: (value: string) => void;
  onPickLogo: (file: File | null) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const trimmed = row.name.trim();

  // Created once per file and revoked when it changes or the row unmounts.
  // Calling createObjectURL in the render body instead would mint a new blob
  // on every keystroke in the name field and never release any of them.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!row.logo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(row.logo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [row.logo]);

  return (
    <div className="flex items-end gap-3 rounded-[10px] bg-[#F8FAFC] p-3">
      {/* Upload happens after the brand exists — its storage key is namespaced
          by brand id — so this only stages the file and previews it. */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        aria-label={`Upload logo for brand ${index + 1}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: trimmed ? avatarColour(trimmed) : '#E2E8F0' }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : trimmed ? (
          trimmed.charAt(0).toUpperCase()
        ) : (
          <ImageIcon className="h-5 w-5 text-[#94A3B8]" aria-hidden />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        name="brandLogo"
        accept="image/jpeg,image/png,image/svg+xml"
        onChange={(e) => onPickLogo(e.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <label className="min-w-0 flex-1" htmlFor={nameId}>
        <span className="mb-1 block text-xs font-semibold text-[#0F172A]">Brand Name</span>
        <input
          id={nameId}
          name="brandName"
          type="text"
          value={row.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Enter brand name"
          aria-invalid={invalid}
          className={`${inputClass} ${invalid ? invalidBorder : validBorder}`}
        />
      </label>

      {showDelete && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove brand ${index + 1}`}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EF4444] text-white transition-colors hover:bg-[#DC2626]"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * FR-ONB step 3 (multi-brand): name every brand up front, then create them all
 * and land on the dashboard.
 *
 * One submission rather than a create-one-then-return loop — a merchant that
 * has just said it operates several brands is describing a set it already
 * knows, so making it round-trip the server once per brand would be busywork.
 */
export function BrandsForm() {
  const [state, formAction, pending] = useActionState(createBrandsAction, initialState);
  const [rows, setRows] = useState<Row[]>([{ key: 0, name: '', logo: null }]);
  const [showErrors, setShowErrors] = useState(false);
  const nextKey = useRef(1);

  const named = rows.filter((r) => r.name.trim().length > 0);
  const canSubmit = named.length > 0 && !pending;

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        setShowErrors(true);
        if (named.length === 0) event.preventDefault();
      }}
      className="space-y-3"
    >
      {rows.map((row, index) => (
        <BrandRow
          key={row.key}
          row={row}
          index={index}
          showDelete={rows.length > 1}
          invalid={showErrors && row.name.trim().length === 0}
          onChangeName={(name) => update(row.key, { name })}
          onPickLogo={(logo) => update(row.key, { logo })}
          onRemove={() => setRows((current) => current.filter((r) => r.key !== row.key))}
        />
      ))}

      <button
        type="button"
        onClick={() =>
          setRows((current) => [...current, { key: nextKey.current++, name: '', logo: null }])
        }
        className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC]"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add Another Brand
      </button>

      {state.error && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-[10px] bg-black px-4 py-3.5 text-base font-bold text-white
                   transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed
                   disabled:bg-[#E5E7EB] disabled:text-[#94A3B8] focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
      >
        {pending ? 'Creating your brands…' : 'Create & Go to Dashboard'}
      </button>
    </form>
  );
}
