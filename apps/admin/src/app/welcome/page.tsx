import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo-mark';
import { getCurrentUser } from '@/lib/api';
import { readSessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Fenwick — Multi-Brand Invoicing & Payments',
  description:
    'Issue invoices and take payments across every brand you operate, from one account. Per-brand numbering, branding, Stripe accounts and books.',
};

export const dynamic = 'force-dynamic';

/**
 * The public front door. Sits outside the (app) group so it renders without the
 * admin shell, and is listed in middleware's PUBLIC_PATHS so an anonymous
 * visitor reaches it instead of being bounced to /login.
 *
 * Someone already signed in is sent to their dashboard rather than shown a
 * pitch for a product they have already bought — checked against the API, not
 * merely the presence of a cookie, since a stale one would otherwise bounce
 * them into the app and straight back out.
 */
export default async function WelcomePage() {
  if (await readSessionToken()) {
    const signedIn = await getCurrentUser().then(
      () => true,
      () => false,
    );
    if (signedIn) redirect('/');
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="[&>svg]:mx-0">
            <LogoMark size={36} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#0F172A]">Fenwick</span>
        </div>
        <Link
          href="/login"
          className="rounded-[10px] px-4 py-2 text-sm font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-[1100px] px-6 pb-20 pt-10 sm:pt-16">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-[#64748B]">
            Multi-brand invoicing &amp; payments
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] tracking-tight text-[#0F172A] sm:text-[56px]">
            Every brand you run, billed from one account.
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-base leading-relaxed text-[#64748B] sm:text-[17px]">
            Separate numbering, branding, payment accounts and books for each brand — without
            separate logins, separate tools, or reconciling it all by hand at month end.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="w-full rounded-[10px] bg-[#0F172A] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] sm:w-auto"
            >
              Create your account
            </Link>
            <a
              href="#how-it-works"
              className="w-full rounded-[10px] border border-[#E2E8F0] px-6 py-3 text-sm font-semibold text-[#0F172A] hover:bg-[#F8FAFC] sm:w-auto"
            >
              How it works
            </a>
          </div>
        </div>

        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-[#E2E8F0] bg-white p-6">
              <h2 className="text-[15px] font-semibold text-[#0F172A]">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#64748B]">{feature.body}</p>
            </div>
          ))}
        </div>

        <div id="how-it-works" className="mt-24 scroll-mt-8">
          <h2 className="text-center text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
            How it works
          </h2>
          <ol className="mx-auto mt-10 grid max-w-[900px] gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F172A] text-[13px] font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-[#0F172A]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#64748B]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-24 rounded-2xl bg-[#0F172A] px-8 py-14 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Ready to send your first invoice?
          </h2>
          <p className="mx-auto mt-3 max-w-[520px] text-sm leading-relaxed text-[#94A3B8] sm:text-base">
            Create an account, add your brands, and send your first invoice in minutes.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-[10px] bg-white px-6 py-3 text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9]"
          >
            Create your account
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#E2E8F0]">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[#64748B] sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Fenwick Holdings Inc.</span>
          <Link href="/login" className="hover:text-[#0F172A]">
            Sign in
          </Link>
        </div>
      </footer>
    </main>
  );
}

const FEATURES = [
  {
    title: 'A real identity per brand',
    body: 'Each brand keeps its own invoice prefix and sequence, logo, colour, payment terms and tax rates. Customers only ever see the brand they bought from.',
  },
  {
    title: 'Paid however they prefer',
    body: 'Card, wallet or bank transfer on a hosted payment page. Card details go straight to Stripe and never touch our servers.',
  },
  {
    title: 'Books that stay reconciled',
    body: 'Customers, invoices and payments sync to Zoho Books both ways, so finance is not re-keying anything at month end.',
  },
] as const;

const STEPS = [
  {
    title: 'Add your brands',
    body: 'Set up one brand or several. Each gets its own numbering, branding and settings from the start.',
  },
  {
    title: 'Invoice your customers',
    body: 'Build an invoice, issue it, and send a payment link carrying that brand’s identity.',
  },
  {
    title: 'Get paid and reconcile',
    body: 'Payments settle against the right brand’s account and flow through to your books automatically.',
  },
] as const;
