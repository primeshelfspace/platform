import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/logo-mark';

export const metadata: Metadata = { title: 'Terms and Conditions — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * Linked from the sign-up form (FR-ONB step 0), so it has to render with no
 * session at all — listed in middleware's PUBLIC_PATHS for exactly that
 * reason. Sits outside the (app) group like every other pre-auth page, so it
 * renders without the admin shell.
 */
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[680px]">
        <div className="mb-10 text-center">
          <LogoMark size={56} />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#0F172A] sm:text-4xl">
            Terms and Conditions
          </h1>
          <p className="mt-3 text-[17px] text-[#64748B]">Last updated August 2026.</p>
        </div>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#334155]">
          <Section title="1. Acceptance of these terms">
            By creating an account or otherwise using Fenwick, you agree to these terms. If you are
            accepting them on behalf of a company, you are confirming you have the authority to
            bind that company.
          </Section>

          <Section title="2. What Fenwick provides">
            Fenwick lets you issue invoices and take payments across one or more brands from a
            single account. Features described as in progress or partial in our documentation are
            provided on that basis, and we will not represent them as complete.
          </Section>

          <Section title="3. Your account">
            You are responsible for the accuracy of the information you provide, for keeping your
            credentials confidential, and for activity that happens under your account. Tell us
            promptly if you believe your account has been accessed without authorization.
          </Section>

          <Section title="4. Payments and fees">
            Card and bank transactions are processed by our payment providers, not by us directly.
            Fees applicable to your account are disclosed before they are charged. You are
            responsible for any taxes owed on amounts you invoice through Fenwick.
          </Section>

          <Section title="5. Acceptable use">
            You will not use Fenwick to invoice for unlawful goods or services, to commit fraud, or
            to attempt to gain unauthorized access to any part of the platform.
          </Section>

          <Section title="6. Termination">
            You may stop using Fenwick at any time. We may suspend or terminate access for a
            material breach of these terms, including non-payment or unlawful use, and will give
            notice where practical.
          </Section>

          <Section title="7. Disclaimers and liability">
            Fenwick is provided on an &ldquo;as is&rdquo; basis. To the extent permitted by law, we
            are not liable for indirect or consequential losses arising from your use of the
            platform.
          </Section>

          <Section title="8. Changes to these terms">
            We may update these terms as the product evolves. Continued use after an update
            constitutes acceptance of the revised terms.
          </Section>

          <Section title="9. Contact">
            Questions about these terms can be sent to{' '}
            <a href="mailto:legal@fenwickholdings.test" className="font-medium text-[#0F172A] underline">
              legal@fenwickholdings.test
            </a>
            .
          </Section>
        </div>

        <p className="mt-12 text-center text-sm text-[#64748B]">
          <Link href="/signup" className="font-semibold text-[#0F172A] underline">
            Back to sign up
          </Link>
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-[#0F172A]">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
