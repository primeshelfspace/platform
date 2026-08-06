import { OnboardingSteps } from '@/components/onboarding-steps';
import { requireOnboardingStep } from '@/lib/onboarding';
import { BrandsForm } from './brands-form';

export const dynamic = 'force-dynamic';

/**
 * FR-ONB step 3 (multi-brand). Every brand is named up front and created in
 * one submission, which is what finishes onboarding and lands on the
 * dashboard — so there is no separate "finish setup" action to forget.
 */
export default async function MultiBrandSetupPage() {
  await requireOnboardingStep('multi-brand-setup');

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[560px]">
        <OnboardingSteps current="Brand" />

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Set Up Your Brands
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Give each brand a name. You can always add more later.
          </p>
        </div>

        <BrandsForm />
      </div>
    </main>
  );
}
