import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/logo-mark';

export const metadata: Metadata = { title: 'Privacy Policy — Fenwick Invoicing' };
export const dynamic = 'force-dynamic';

/**
 * Linked from the sign-up form (FR-ONB step 0), so it has to render with no
 * session at all — listed in middleware's PUBLIC_PATHS for exactly that
 * reason. Sits outside the (app) group like every other pre-auth page, so it
 * renders without the admin shell.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[680px]">
        <div className="mb-10 text-center">
          <LogoMark size={56} />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#0F172A] sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-[17px] text-[#64748B]">Last updated August 2026.</p>
        </div>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#334155]">
          <Section title="1. What we collect">
            Account details you give us directly (name, email, company and brand information), and
            the invoice, customer and payment records you create while using Fenwick.
          </Section>

          <Section title="2. How we use it">
            To operate your account, issue invoices and process payments on your behalf, send
            transactional email such as sign-up and password links, and maintain the security
            audit log required to protect every account on the platform.
          </Section>

          <Section title="3. Who we share it with">
            Payment processors, to complete transactions you initiate. Accounting integrations you
            explicitly connect (such as Zoho Books). We do not sell your data to third parties.
          </Section>

          <Section title="4. Data isolation between brands and tenants">
            Every account's data is isolated from every other account's at the database level, not
            just in the application layer, so one tenant's records are never visible to another.
          </Section>

          <Section title="5. Retention">
            We retain account and transaction records for as long as your account is active and for
            the period required afterward for financial and legal record-keeping.
          </Section>

          <Section title="6. Security">
            Passwords are never stored in plain text. Session and password-reset tokens are stored
            as one-way hashes. Access to production data is limited to what is required to operate
            the platform.
          </Section>

          <Section title="7. Your choices">
            You can request a copy of your account's data or its deletion, subject to the financial
            record-keeping obligations described above, by contacting us at the address below.
          </Section>

          <Section title="8. Changes to this policy">
            We may update this policy as the product evolves. Material changes will be reflected
            here with a new effective date.
          </Section>

          <Section title="9. Contact">
            Questions about this policy can be sent to{' '}
            <a
              href="mailto:privacy@fenwickholdings.test"
              className="font-medium text-[#0F172A] underline"
            >
              privacy@fenwickholdings.test
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
