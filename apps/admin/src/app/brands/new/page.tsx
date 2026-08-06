import { OnboardingSteps } from '@/components/onboarding-steps';
import { requireOnboardingStep } from '@/lib/onboarding';
import { CompanyDetailsForm } from './company-details-form';

export const dynamic = 'force-dynamic';

/**
 * FR-ONB step 1 of 3: the company behind the brands, staged on Merchant before
 * any Brand exists.
 *
 * It previously announced itself as "Create Your First Brand", which was simply
 * wrong — nothing here creates a brand. The single-brand path derives one from
 * these details two steps later, and the multi-brand path never does. Saying
 * "brand" made the first thing a new customer sees describe the wrong object.
 *
 * The route is still /brands/new because four empty-state screens link to it;
 * only what the page claims to be has changed.
 */
export default async function CompanyDetailsPage() {
  await requireOnboardingStep('company-details');

  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1000px]">
        <OnboardingSteps current="Company" />

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
            Company Details
          </h1>
          <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
            Tell us about your business. This information appears across your invoices.
          </p>
        </div>

        <CompanyDetailsForm />
      </div>
    </main>
  );
}
