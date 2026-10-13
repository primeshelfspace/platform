import { Check } from 'lucide-react';
import { LogoMark } from '@/components/logo-mark';
import { ONBOARDING_STEPS, type OnboardingStepLabel } from '@/components/onboarding-steps';

/**
 * The top bar shown across the Company → Structure → Brand onboarding wizard:
 * the brand mark pinned to the left, and the step stepper centered on the
 * full page width (not just the remaining space beside the logo).
 *
 * Sizes/colors are taken directly from the supplied design: 36px logo mark,
 * 22px step circles, emerald for a finished step, #262626 for the current
 * step, a bordered white circle with #737373 text for steps not yet reached.
 *
 * `complete` marks every step done, including `current` — for the one screen
 * reached only after the whole wizard has finished (Brand Created), where
 * there is no "next" step left to be the active one.
 */
export function OnboardingHeader({
  current,
  complete = false,
}: {
  current: OnboardingStepLabel;
  complete?: boolean;
}) {
  const currentIndex = ONBOARDING_STEPS.indexOf(current);

  return (
    <header className="relative flex h-[60px] items-center border-b border-[#F0F0F0] bg-white px-5">
      <div className="absolute left-5 top-1/2 -translate-y-1/2">
        <LogoMark size={36} />
      </div>

      <ol
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center"
        aria-label="Setup progress"
      >
        {ONBOARDING_STEPS.map((label, index) => {
          const done = complete || index < currentIndex;
          const active = !complete && index === currentIndex;

          return (
            <li key={label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-current={active ? 'step' : undefined}
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : active
                        ? 'bg-[#262626] text-white'
                        : 'border border-[#E5E5E5] bg-white text-[#737373]'
                  }`}
                >
                  {done ? <Check className="h-3 w-3" aria-hidden /> : index + 1}
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    done || active ? 'text-[#171717]' : 'text-[#737373]'
                  }`}
                >
                  {label}
                </span>
              </div>
              {index < ONBOARDING_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={`mx-6 mb-5 h-px w-[50px] ${done ? 'bg-emerald-500' : 'bg-[#E5E5E5]'}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </header>
  );
}
