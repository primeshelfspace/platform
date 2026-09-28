'use client';

import { useActionState, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import type { Brand, ManagedUser } from '@/lib/api';
import { updateUserBrandsAction, type UpdateUserState } from './actions';

const initialState: UpdateUserState = {};

export function AssignBrandsModal({
  user,
  brands,
  onClose,
  onUpdated,
}: {
  /** Null closes the modal — kept as a single prop (rather than open + user)
   * so the parent can't render it open without a target. */
  user: ManagedUser | null;
  brands: Brand[];
  onClose: () => void;
  onUpdated: (user: ManagedUser) => void;
}) {
  const action = updateUserBrandsAction.bind(null, user?.id ?? '');
  const [state, formAction, pending] = useActionState(action, initialState);
  useFormStatusToast(state, 'Brand assignments updated.');

  const [selected, setSelected] = useState<Set<string>>(new Set(user?.assignedBrandIds ?? []));

  useEffect(() => {
    setSelected(new Set(user?.assignedBrandIds ?? []));
  }, [user]);

  useEffect(() => {
    if (state.user) onUpdated(state.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.user]);

  if (!user) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      titleId="assign-brands-heading"
      title={`Brands for ${user.name}`}
    >
      <form action={formAction} className="space-y-4">
        {brands.length === 0 ? (
          <p className="text-sm text-ink-muted">No brands exist yet.</p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-[#E5E7EB] p-3">
            {brands.map((brand) => (
              <label key={brand.id} className="flex items-center gap-2 text-sm text-[#0F172A]">
                <input
                  type="checkbox"
                  name="brandIds"
                  value={brand.id}
                  checked={selected.has(brand.id)}
                  onChange={() => toggle(brand.id)}
                  className="h-4 w-4 accent-black"
                />
                {brand.displayName}
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-[#E5E7EB] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#0F172A] bg-white px-5 py-2.5 text-sm font-bold text-[#0F172A]
                       transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white transition-colors
                       hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                       disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-black focus-visible:ring-offset-1"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
