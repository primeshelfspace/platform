'use client';

import { useActionState, useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useFormStatusToast } from '@/hooks/use-form-status-toast';
import { chooseBrandStructureAction, type BrandStructureState } from './actions';

const initialState: BrandStructureState = {};

type Structure = 'SINGLE' | 'MULTI';

interface StructureOption {
  value: Structure;
  title: string;
  description: string;
  icon: typeof Building2;
}

const OPTIONS: StructureOption[] = [
  {
    value: 'SINGLE',
    title: 'Single brand',
    description: 'All invoices share one brand identity. Company data is copied automatically.',
    icon: Building2,
  },
  {
    value: 'MULTI',
    title: 'Multi-brand',
    description: 'Operate multiple distinct brands from one account. Configure each independently.',
    icon: Plus,
  },
];

function StructureCard({
  option,
  selected,
  onSelect,
}: {
  option: StructureOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex-1 rounded-[14px] border p-6 text-left transition-colors focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2
                  ${selected ? 'border-2 border-black' : 'border-[#D1D5DB] hover:border-slate-400'}`}
    >
      <span
        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full transition-colors
                    ${selected ? 'bg-black text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="block text-lg font-bold text-[#0F172A]">{option.title}</span>
      <span className="mt-1 block text-[15px] text-[#64748B]">{option.description}</span>
    </button>
  );
}

export function StructureForm() {
  const [state, formAction, pending] = useActionState(chooseBrandStructureAction, initialState);
  useFormStatusToast(state);
  const [selected, setSelected] = useState<Structure | null>(null);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="brandStructure" value={selected ?? ''} />

      <div
        role="radiogroup"
        aria-label="Brand structure"
        className="flex flex-col gap-6 sm:flex-row"
      >
        {OPTIONS.map((option) => (
          <StructureCard
            key={option.value}
            option={option}
            selected={selected === option.value}
            onSelect={() => setSelected(option.value)}
          />
        ))}
      </div>

      <button
        type="submit"
        disabled={!selected || pending}
        className="w-full rounded-[10px] bg-black px-4 py-3.5 text-base font-bold text-white
                   transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB]
                   disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-black focus-visible:ring-offset-2"
      >
        {pending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}
