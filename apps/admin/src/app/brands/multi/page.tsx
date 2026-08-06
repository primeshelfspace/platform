import { listBrands } from '@/lib/api';
import { OnboardingSteps } from '@/components/onboarding-steps';
import { requireOnboardingStep } from '@/lib/onboarding';
import { AddBrandForm } from './add-brand-form';
import { FinishSetupForm } from './finish-setup-form';

export const dynamic = 'force-dynamic';

/**
 * No screenshot exists for this step — built as a clean, minimal, working
 * screen rather than a mockup: a running list of brands added so far, a
 * lightweight add-a-brand form, and a "Finish Setup" action gated (both
 * client-side, disabled, and server-side, in completeMultiBrandOnboarding)
 * on at least one brand actually existing.
 */
export default async function MultiBrandSetupPage() {
  await requireOnboardingStep('multi-brand-setup');
  const brands = await listBrands();

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[720px]">
        <OnboardingSteps current="Brand" />

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Add Your Brands
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Add each brand you operate. You can add more later from the dashboard.
          </p>
        </div>

        {brands.length > 0 && (
          <ul className="mb-8 space-y-3">
            {brands.map((brand) => (
              <li
                key={brand.id}
                className="flex items-center justify-between rounded-[10px] border border-[#D1D5DB] bg-white px-4 py-3"
              >
                <span className="font-bold text-[#0F172A]">{brand.displayName}</span>
                <span className="text-sm text-[#64748B]">{brand.legalName}</span>
              </li>
            ))}
          </ul>
        )}

        <AddBrandForm />

        <FinishSetupForm hasBrands={brands.length > 0} />
      </div>
    </main>
  );
}
