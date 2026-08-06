/**
 * The Company → Structure → Brand progress indicator shown across onboarding.
 *
 * Presentational only. The authoritative current step is always
 * resolveOnboardingStep, computed from real rows — this just draws where that
 * answer sits in the sequence, so the two cannot disagree about what happens
 * next.
 */
const STEPS = ['Company', 'Structure', 'Brand'] as const;
export type OnboardingStepLabel = (typeof STEPS)[number];

export function OnboardingSteps({ current }: { current: OnboardingStepLabel }) {
  const currentIndex = STEPS.indexOf(current);

  return (
    <ol className="mb-8 flex items-center justify-center gap-2" aria-label="Setup progress">
      {STEPS.map((label, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1.5">
              <span
                aria-current={active ? 'step' : undefined}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ${
                  done || active ? 'bg-[#0F172A] text-white' : 'bg-[#E2E8F0] text-[#94A3B8]'
                }`}
              >
                {index + 1}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  done || active ? 'text-[#0F172A]' : 'text-[#94A3B8]'
                }`}
              >
                {label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden
                className={`mb-5 h-px w-10 sm:w-16 ${done ? 'bg-[#0F172A]' : 'bg-[#E2E8F0]'}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
