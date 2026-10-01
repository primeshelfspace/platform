'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { coversAllBrands, type Role } from '@fenwick/shared';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  FIELD_VALID_BORDER_PRIMARY as validBorder,
  VALIDATED_FIELD_INPUT_CLASS as inputClass,
  VALIDATED_FIELD_LABEL_CLASS as labelClass,
} from '@/components/ui/form-styles';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import type { Brand, ManagedUser } from '@/lib/api';
import { ROLE_LABELS } from './role-labels';
import { inviteUserAction, type InviteUserState } from './actions';

const initialState: InviteUserState = {};

/**
 * The Users & Roles list's "Invite user" modal. Follows AddCustomerModal's
 * shape: stays mounted while closed, reads the new record off action state to
 * close itself and let the parent refresh the table.
 */
export function InviteUserModal({
  open,
  brands,
  assignableRoles,
  onClose,
  onInvited,
}: {
  open: boolean;
  brands: Brand[];
  /** From GET /auth/me — the API's own mayAssignRole, not re-derived here. */
  assignableRoles: Role[];
  onClose: () => void;
  onInvited: (user: ManagedUser) => void;
}) {
  const [state, formAction, pending] = useActionState(inviteUserAction, initialState);
  useFormStatusToast(state, 'Invitation sent.');
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [role, setRole] = useState<Role>('READ_ONLY');
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const brandsRequired = !coversAllBrands(role);

  useEffect(() => {
    if (!state.user) return;
    onInvited(state.user);
    formRef.current?.reset();
    setRole('READ_ONLY');
    setSelectedBrands(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.user]);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function toggleBrand(id: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal open={open} onClose={onClose} titleId="invite-user-heading" title="Invite User">
      <form ref={formRef} action={formAction} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Name</span>
          <input
            ref={firstFieldRef}
            name="name"
            required
            placeholder="Full name"
            className={`${inputClass} ${validBorder}`}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Email address</span>
          <input
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            className={`${inputClass} ${validBorder}`}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Role</span>
          <Select name="role" value={role} onChange={(value) => setRole(value as Role)}>
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>

        {brandsRequired && (
          <div>
            <span className={labelClass}>Brands</span>
            {brands.length === 0 ? (
              <p className="text-sm text-ink-muted">No brands exist yet.</p>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-[#E5E7EB] p-3">
                {brands.map((brand) => (
                  <label key={brand.id} className="flex items-center gap-2 text-sm text-[#0F172A]">
                    <input
                      type="checkbox"
                      name="brandIds"
                      value={brand.id}
                      checked={selectedBrands.has(brand.id)}
                      onChange={() => toggleBrand(brand.id)}
                      className="h-4 w-4 accent-black"
                    />
                    {brand.displayName}
                  </label>
                ))}
              </div>
            )}
            {selectedBrands.size === 0 && (
              <p className="mt-1.5 text-sm text-red-600" role="alert">
                This role needs at least one assigned brand.
              </p>
            )}
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
            disabled={pending || (brandsRequired && selectedBrands.size === 0)}
            className="rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white transition-colors
                       hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                       disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-black focus-visible:ring-offset-1"
          >
            {pending ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
