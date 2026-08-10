/**
 * The Company → Structure → Brand step list shared by the onboarding wizard.
 *
 * The authoritative current step is always resolveOnboardingStep, computed
 * from real rows — this list only names the sequence so OnboardingHeader can
 * draw where a given step sits in it.
 */
export const ONBOARDING_STEPS = ['Company', 'Structure', 'Brand'] as const;
export type OnboardingStepLabel = (typeof ONBOARDING_STEPS)[number];
