import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import {
  getCurrentUser,
  getMerchantOnboarding,
  listBrands,
  type Brand,
  type CurrentUser,
} from '@/lib/api';
import { LOGIN_PATH } from '@/lib/session';
import { resolveOnboardingStep, routeForStep } from '@/lib/onboarding';

/**
 * The authenticated half of the app. Everything below this layout is behind a
 * session AND behind finished onboarding — none of the onboarding routes
 * live in this route group (they render chrome-less, without AdminShell),
 * so there is no risk of this redirect looping against itself.
 *
 * Middleware turns away requests carrying no cookie at all, but a cookie is not
 * a session — it can be expired, revoked, or point at a suspended user. This is
 * where that is settled, against the API, on every render. Middleware is the
 * cheap filter; this is the actual gate.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  // This layout re-renders on the server on every navigation under it (it
  // reads cookies(), so it can never be statically cached) — so every one of
  // its awaits is latency every single click pays. listBrands doesn't depend
  // on who the user is, so it starts alongside getCurrentUser instead of
  // after it; a failure here still falls back to "no brands" exactly as
  // before, it just no longer blocks behind the session check to do so.
  let user: CurrentUser;
  let brands: Brand[] = [];
  try {
    const [resolvedUser, resolvedBrands] = await Promise.all([
      getCurrentUser(),
      listBrands().catch(() => [] as Brand[]),
    ]);
    user = resolvedUser;
    brands = resolvedBrands;
  } catch {
    // Any failure to establish who this is means no access. The cookie is left
    // for /login to clear, so a momentary API outage does not silently sign
    // everyone out of a session that is still perfectly valid.
    redirect(`${LOGIN_PATH}?expired=1`);
  }

  // FR-AUTH-007/021 and FR-ONB: a first-login password reset and finishing
  // onboarding both gate everything else in the app — same mechanism either
  // way, since resolveOnboardingStep checks mustResetPassword first.
  const step = await resolveOnboardingStep(user);
  if (step) {
    redirect(routeForStep(step));
  }

  // The sidebar header names the merchant, not any one brand — falls back to
  // the product name for the same "role can't reach it" case as brands above,
  // rather than leaving the header blank.
  let companyName = 'Prime Shelf Space Inc.';
  try {
    const onboarding = await getMerchantOnboarding();
    if (onboarding.companyDetails?.legalName) companyName = onboarding.companyDetails.legalName;
  } catch {
    // Same reasoning as the brands fetch above.
  }

  return (
    <Suspense fallback={null}>
      <AdminShell brands={brands} user={user} companyName={companyName}>
        {children}
      </AdminShell>
    </Suspense>
  );
}
