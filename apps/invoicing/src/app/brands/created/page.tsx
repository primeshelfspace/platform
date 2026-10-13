import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { LogoMark } from '@/components/logo-mark';
import { OnboardingHeader } from '@/components/onboarding-header';
import { listBrands } from '@/lib/api';
import { requireOnboardingComplete } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

/**
 * Reached right after the single-brand-structure choice creates one brand
 * from the staged company details. Onboarding is complete the instant that
 * happens, so this page is only meaningfully reachable once in the sense
 * that matters — an `id` in the query string names which brand this
 * celebrates, and it has to actually belong to this merchant. That is what
 * keeps a stale bookmark, a hand-edited query string, or the query string
 * simply missing from rendering anything at all; all three fall through to
 * the dashboard instead. Looking the brand up rather than trusting whatever
 * the query string claims also means the real logo (if one was uploaded
 * during Company Details) shows here, not just the name.
 */
export default async function BrandCreatedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireOnboardingComplete();

  const params = await searchParams;
  const brand = params.id ? (await listBrands()).find((b) => b.id === params.id) : undefined;
  if (!brand) redirect('/');

  return (
    <>
      <OnboardingHeader current="Brand" complete />
      <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[640px]">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#0F172A] sm:text-4xl">
              Brand Created
            </h1>
            <p className="mt-2 text-base text-[#64748B] sm:text-[17px]">
              Since you operate a single brand, your company details have been copied automatically.
            </p>
          </div>

          <div className="flex items-center gap-4 rounded-[14px] bg-[#F1F5F9] p-5">
            {brand.logoUrl ? (
              // The brand's own uploaded logo, not the product mark — this is
              // the one onboarding screen where a brand already exists.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <LogoMark size={48} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-[#0F172A]">{brand.displayName}</p>
              <p className="text-sm text-[#64748B]">Default brand</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" aria-hidden />
              Auto-configured
            </span>
          </div>

          <a
            href="/"
            className="mt-6 block w-full rounded-[10px] bg-black px-4 py-3.5 text-center text-base font-bold text-white
                       transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-black focus-visible:ring-offset-2"
          >
            Go to Dashboard
          </a>
        </div>
      </main>
    </>
  );
}
