# What a user can do — and the test that proves it

Every action a normal person can take in Sugrpay, who can take it, and where
it is tested. **E2E n** is test _n_ in
[`e2e/user-journeys.test.ts`](../../e2e/user-journeys.test.ts), which starts
the platform and Sugrpay APIs and drives them over real HTTP exactly as the web
app does, sending each call to the API that owns it (`apiServiceFor`). Run it
with `pnpm test` (or `pnpm --filter @platform/e2e test`). Other entries
name the unit or database test file. "UI only" means the behaviour lives in the
web app and is checked by hand (the web app has no browser tests yet).

People: **Owner**, **Admin**, **Brand Admin**, **Finance**, **Sales**,
**Read-only** (staff roles, see `packages/kernel/src/domain/roles.ts`) and the
**Customer** (pays an invoice from a link, never signs in).

## 1. Account

| #    | Scenario                                            | Who      | Expected                                                 | Tested by                      |
| ---- | --------------------------------------------------- | -------- | -------------------------------------------------------- | ------------------------------ |
| 1.1  | Sign up with name and email                         | Anyone   | Company + owner created, set-password email sent         | E2E 1, `signup.test.ts`        |
| 1.2  | Set the password from the emailed link              | New user | Signed in; link cannot be used again                     | E2E 1, `signup.test.ts`        |
| 1.3  | Sign up again before setting a password             | New user | Link re-sent (at most 3 an hour), no second company      | `signup.test.ts`               |
| 1.4  | Sign up with an address that already has an account | Anyone   | 409 "already exists"                                     | E2E 2, `signup.test.ts`        |
| 1.5  | Sign up when the email cannot be sent               | Anyone   | 503 "try again", nothing kept, retry works               | `signup.test.ts`               |
| 1.6  | Sign up with an address another company has invited | Anyone   | Gets their own company; the invitation is untouched      | `signup.test.ts`               |
| 1.7  | Sign in                                             | Staff    | Session (httpOnly cookie)                                | E2E 3                          |
| 1.8  | Sign in with a wrong password / unknown email       | Anyone   | Same 401 for both                                        | E2E 3, `auth.service.test.ts`  |
| 1.9  | Five wrong passwords in 15 minutes                  | Anyone   | Account locked 30 minutes                                | `auth.service.test.ts`         |
| 1.10 | Many sign-in attempts for one email                 | Anyone   | 429 after 10 in 5 minutes                                | E2E 25, `rate-limit.test.ts`   |
| 1.11 | Forgot password → reset from the email              | Staff    | New password works, old one and every old session do not | E2E 17                         |
| 1.12 | Change password while signed in                     | Staff    | Needs the current password; other sessions end           | E2E 18, `auth.service.test.ts` |
| 1.13 | Sign out                                            | Staff    | Session ends on the server                               | E2E 19                         |
| 1.14 | Session older than 12 hours                         | Staff    | 401 → sign in again                                      | `session.service.ts` (resolve) |

## 2. Getting set up

| #   | Scenario                                                         | Who                       | Expected                                     | Tested by                                                |
| --- | ---------------------------------------------------------------- | ------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| 2.1 | Enter company details                                            | Owner, Admin              | Saved; email must match the website's domain | E2E 4, `schemas.test.ts`                                 |
| 2.2 | Choose single brand                                              | Owner, Admin              | Brand created from the company details       | E2E 4                                                    |
| 2.3 | Choose multi-brand and add brands                                | Owner, Admin              | Brands created; finish onboarding when done  | not automated yet                                        |
| 2.4 | Upload a logo (JPG/PNG/SVG ≤ 5 MB)                               | Owner, Admin, Brand Admin | Saved                                        | E2E 6                                                    |
| 2.5 | Upload a file that is not really an image, or an SVG with script | Same                      | 400                                          | E2E 6, `image-content.test.ts`                           |
| 2.6 | Turn payment methods on/off (card, wallets, ACH, check)          | Owner, Admin, Brand Admin | Saved; the payment page offers only those    | E2E 5, `brand-settings.service.test.ts`                  |
| 2.7 | Edit branding: payment page, email receipt, invoice PDF          | Owner, Admin, Brand Admin | Saved; previews match                        | `brand-settings.service.test.ts`, UI only                |
| 2.8 | Send a test receipt email                                        | Owner, Admin, Brand Admin | Sent; at most 30 a day per company           | `rate-limit.test.ts`                                     |
| 2.9 | Connect Stripe / Square / Zoho                                   | Owner, Admin, Brand Admin | Provider's consent screen, then connected    | `oauth-state.test.ts`, `zoho-connect.controller.test.ts` |

## 3. Customers and invoices

| #   | Scenario                                                                      | Who                                 | Expected                                       | Tested by                                                |
| --- | ----------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| 3.1 | Add, edit, search customers                                                   | All but Read-only (Read-only views) | Saved and found                                | E2E 7                                                    |
| 3.2 | Create a draft invoice                                                        | Owner … Sales                       | Totals computed on the server                  | E2E 8, `invoices.service.test.ts`, `calculation.test.ts` |
| 3.3 | Send (issue) an invoice                                                       | Owner … Sales                       | Number assigned, payment link live, email sent | E2E 8                                                    |
| 3.4 | Send or re-send the invoice email                                             | Owner … Sales                       | Sent; at most 300 a day per company            | `invoices.service.test.ts`, `rate-limit.test.ts`         |
| 3.5 | Record a payment by hand (cash, check, wire)                                  | Owner … Finance                     | Balance reduced; PARTIALLY_PAID or PAID        | E2E 9, `invoices.service.test.ts`                        |
| 3.6 | Cancel an invoice                                                             | Owner … Finance                     | CANCELLED; the link takes no payment           | E2E 11                                                   |
| 3.7 | See the invoice list, tabs, dashboard                                         | Everyone                            | Own company's data only                        | E2E 13, `dashboard.service.test.ts`                      |
| 3.8 | Review a mailed check: approve with the amount on it, or reject with a reason | Owner … Finance                     | Payment recorded for that amount / rejected    | E2E 10, `checks.service.test.ts`                         |

## 4. The customer paying

| #    | Scenario                                          | Expected                                           | Tested by                                 |
| ---- | ------------------------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| 4.1  | Open the payment link                             | Invoice shown; first view marks it VIEWED          | E2E 8, `public-invoices.service.test.ts`  |
| 4.2  | Pay by ACH or card                                | PAID; card fee only on card/wallet                 | E2E 8, `payments.service.test.ts`         |
| 4.3  | Pay what is left after a partial payment          | Charged the balance only                           | E2E 9, `payments.service.test.ts`         |
| 4.4  | Payment declined                                  | Invoice back to its previous status; try again     | `payments.service.test.ts`                |
| 4.5  | Pay twice (double click, two tabs)                | One charge; a late extra one is flagged for refund | `payments.service.test.ts`                |
| 4.6  | Upload photos of a mailed check                   | Waiting for staff review (at most 3 at once)       | E2E 10, `public-invoices.service.test.ts` |
| 4.7  | Pay or upload a check on a cancelled/paid invoice | Refused                                            | E2E 11, `public-invoices.service.test.ts` |
| 4.8  | Download the invoice PDF                          | PDF                                                | E2E 22                                    |
| 4.9  | Open a wrong or old link                          | "Not found", nothing revealed                      | E2E 23, `public-invoices.service.test.ts` |
| 4.10 | Try to start a "manual" payment from the page     | 400                                                | E2E 12                                    |

## 5. The team

| #   | Scenario                                                         | Who                                                 | Expected                                          | Tested by                                |
| --- | ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| 5.1 | Invite a teammate with a role and brands                         | Owner, Admin, Brand Admin (own brands, roles ≤ own) | Invitation email; at most 100 a day               | E2E 14, `users.service.test.ts`          |
| 5.2 | The teammate joins from the email                                | Invited user                                        | Signed in with that role                          | E2E 14                                   |
| 5.3 | A Finance user works on invoices but cannot manage team/settings | Finance                                             | 403 on those                                      | E2E 15, `roles.test.ts`                  |
| 5.4 | Change a teammate's role or brands                               | Owner, Admin, Brand Admin                           | Saved; never above the actor's own rank           | `users.service.test.ts`                  |
| 5.5 | A Brand Admin changes someone who also works on other brands     | Brand Admin                                         | 403                                               | `users.service.test.ts`                  |
| 5.6 | Suspend a teammate                                               | Owner, Admin, Brand Admin                           | Their sessions end; sign-in and old links refused | E2E 16                                   |
| 5.7 | Remove the last owner                                            | Owner                                               | Refused                                           | not automated yet (`assertNotLastOwner`) |
| 5.8 | Change your own role or status                                   | Anyone                                              | Refused                                           | `users.service.test.ts`                  |

## 6. What must never work

| #   | Attempt                                                                 | Expected                                 | Tested by                                            |
| --- | ----------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| 6.1 | Any private route without a session, or with a made-up one              | 401                                      | E2E 21, `authorisation-guard.test.ts`                |
| 6.2 | One company's owner opens, changes or connects another company's brand  | 403 / 404                                | E2E 20, `authorisation-guard.test.ts`, `rls.test.ts` |
| 6.3 | A brand-scoped user reaches a brand they are not assigned               | 403                                      | `authorisation-guard.test.ts`, `rls.test.ts`         |
| 6.4 | Another website's script calls the API with the user's cookie           | No CORS headers → blocked by the browser | E2E 24, `http-security.test.ts`                      |
| 6.5 | A sign-in link that sends the user to another site (`?next=/\evil.com`) | Ignored → home                           | `session.test.ts` (contracts)                        |
| 6.6 | Assign a Zoho record to another company's brand                         | Refused                                  | `zoho-webhook.service.test.ts`                       |
| 6.7 | A forged payment webhook, or one for a different amount                 | Ignored                                  | `payments.service.test.ts`                           |
