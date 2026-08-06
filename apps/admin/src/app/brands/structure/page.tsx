import { OnboardingSteps } from '@/components/onboarding-steps';
import { requireOnboardingStep } from '@/lib/onboarding';
import { StructureForm } from './structure-form';

export const dynamic = 'force-dynamic';

export default async function BrandStructurePage() {
  await requireOnboardingStep('brand-structure');

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1000px]">
        <OnboardingSteps current="Structure" />

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Brand Structure
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            How many brands do you operate? This is only asked once, at signup.
          </p>
        </div>

        <StructureForm />
      </div>
    </main>
  );
}
