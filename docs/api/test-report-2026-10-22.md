# API test report — 22 October 2026

> Historical: this tested the single API of the time (`apps/api`, port 4000). The API was later split into three — see [decision 0005](../architecture/decisions/0005-separate-apis.md).

A full check of every endpoint ([endpoints.md](endpoints.md)): 122 routes in 22
controllers. Backend commit `5e3e8af`.

**Result: everything works.** All 468 automated tests pass, every read route
answers correctly, the full invoice-to-payment flow works end to end, and no
data crosses between companies. Three security hardening items were found —
none exposes data today — listed under [Findings](#findings).

| Check                                   | Where      | Result                                              |
| --------------------------------------- | ---------- | --------------------------------------------------- |
| 1. Automated test suite                 | local      | **468 / 468 passed**                                |
| 2. Every read (GET) route, as the owner | local      | **57 / 57 correct** (45 data, 12 expected refusals) |
| 3. End-to-end write flow                | local      | **27 / 27 steps passed**                            |
| 4. Access rules                         | local      | **16 / 16 — no data leaked**; 1 hardening item      |
| 5. Production, read-only                | production | **21 / 23**; 2 hardening items                      |

Local runs used the demo data (`pnpm db:seed`) and the built-in test payment
gateway. Production checks never signed in and never sent a valid write: the
production databases had 0 rows before and after.

## 1. Automated test suite

`pnpm test` against real PostgreSQL databases.

| Package             | Test files | Tests   |
| ------------------- | ---------- | ------- |
| API (all modules)   | 26         | 275     |
| kernel              | 8          | 98      |
| platform-contracts  | 4          | 31      |
| invoicing-contracts | 4          | 64      |
| **Total**           | **42**     | **468** |

Covers sign-in and lockout, users and roles, brands, locations and
subscriptions, customers, invoices and their state machine, payments and
webhooks, checks, brand settings, the dashboard, Zoho push, pull, webhooks and
sandboxes, Stripe/Square OAuth state, credential encryption, module boundaries,
"every route declares a permission", and row-level security in both databases.

## 2. Every read route

Each GET route called as the demo owner with real record IDs.

- **45 returned data**, in 8–150 ms (the invoice PDF: 0.7 s, rendered by
  headless Chrome).
- **12 returned the correct refusal**: 404 for records that do not exist in the
  demo brand (checks, Zoho sandboxes on a brand not connected to Zoho); 400
  "not configured" for Stripe and Square connect (no keys locally); 400 for the
  three OAuth callbacks called without a code; 404 for an unsigned file link.

## 3. End-to-end write flow

| Step                                                                           | Result                             |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| Create, update and search a customer                                           | ✅                                 |
| Create an invoice draft — total calculated server-side ($125.50)               | ✅                                 |
| An invoice with no lines is rejected (400)                                     | ✅                                 |
| Issue the invoice → `SENT`, payment link live                                  | ✅                                 |
| Email preview, then email the invoice with its PDF                             | ✅ (delivered to the mail catcher) |
| Public payment page data and PDF                                               | ✅                                 |
| An unknown payment link is refused (404)                                       | ✅                                 |
| Turn on ACH, pay by ACH → invoice `PAID`, balance 0                            | ✅                                 |
| The payment appears in Payments; history: issue → first view → payment settled | ✅                                 |
| Record a partial manual payment → `PARTIALLY_PAID`, $25.00 left                | ✅                                 |
| Cancel an invoice → `CANCELLED`                                                | ✅                                 |
| Customer uploads a check → staff approves → invoice `PAID`                     | ✅                                 |
| Change and restore payment page layout; send a test email                      | ✅                                 |
| Create and archive a location                                                  | ✅                                 |
| Invite a team member                                                           | ✅                                 |

## 4. Access rules

| Check                                                                                | Result                         |
| ------------------------------------------------------------------------------------ | ------------------------------ |
| All 101 protected routes refuse a request with no sign-in (401)                      | ✅                             |
| A fake session token is refused                                                      | ✅                             |
| Sales user cannot list the team; cannot change billing (403)                         | ✅                             |
| Read-only user cannot invite or create customers (403), can read                     | ✅                             |
| Brand admin cannot open an unassigned brand (403), can open theirs                   | ✅                             |
| Brand list only shows the user's brands                                              | ✅                             |
| Another company sees none of our brands or people                                    | ✅                             |
| Another company's owner asking for our brand's invoices, customers, payments, checks | ⚠️ empty / 404 — see finding 1 |
| Wrong password refused; a signed-out session stops working                           | ✅                             |

## 5. Production (read-only)

| Check                                                                 | Result       |
| --------------------------------------------------------------------- | ------------ |
| Health: production mode, both databases, Redis, queues, S3 up         | ✅           |
| Real adapters active: Stripe, S3, SMTP                                | ✅           |
| Plain HTTP redirects to HTTPS; certificate valid to 19 Jan 2027       | ✅           |
| All 101 protected routes refuse a request with no sign-in             | ✅           |
| Malformed / unknown payment links refused (400 / 404)                 | ✅           |
| Empty sign-up, sign-in and payment requests rejected, nothing created | ✅           |
| Stripe and test-gateway webhooks refuse unsigned calls                | ✅           |
| Zoho webhook refuses a call without its token                         | ✅           |
| OAuth callbacks without a code refused                                | ✅           |
| CORS allows the Sugrpay site                                          | ✅           |
| CORS refuses other websites                                           | ❌ finding 2 |
| No `X-Powered-By` header                                              | ❌ finding 3 |

## Findings

None of these exposes data today; each removes a layer an attacker would
otherwise get for free.

### 1. Owner/Admin requests for another company's brand pass the first gate — medium

`canReachBrand` (`packages/kernel/src/tenancy.ts:62`) returns `true` for any
brand id when the user's role covers all brands, without checking the brand
belongs to the user's company. A Northgate owner asking for
`/brands/<Sugrpay Holdings brand>/invoices` therefore gets `200` with an
**empty** list (and zero totals, and "not connected" for integrations) instead
of `403`. Row-level security in the database is what keeps the data out — the
request reached it with nothing else stopping it.

**Fix:** resolve the company's brand ids into the scope for all-brand roles too,
and check membership in `canReachBrand`; add a test that a foreign brand id
gets `403` for an owner.

### 2. CORS accepts every origin — medium

`apps/api/src/main.ts` reflects any `Origin` with credentials allowed, so a page
on any website can make a signed-in user's browser call the API. The session
cookie is `SameSite=Lax`, which blocks most of this, but the API should not rely
on that alone.

**Fix:** allow only the Sugrpay site's origin (from `ADMIN_PUBLIC_URL`).

### 3. `X-Powered-By: Express` is sent — low

Tells attackers the framework. **Fix:** `app.disable('x-powered-by')` in
`main.ts`.

### Also noticed

- `GET /brands/:brandId/integrations/zoho/connect` redirects to Zoho with an
  empty `client_id` when Zoho is not configured; Stripe and Square answer `400`
  "not configured" instead. Harmless (Zoho shows an error), but inconsistent.
- Email does not work on production yet: the Gmail login is rejected
  (the configured password is not a Gmail app password). Sign-up, password
  reset and sending invoices need it.
- The test suite is not repeatable without re-seeding: a second `pnpm test`
  fails one test (`invoices.service.test.ts` › cancel › "enqueues a Zoho push…")
  because it reuses the fixed Zoho id `remote-cancel-1`, which the previous run
  left behind. `pnpm db:seed` first, as the getting-started guide says, and it
  passes.

## Re-running these checks

- Automated tests: `pnpm db:seed && pnpm test` (local only — the seed wipes the
  local demo databases).
- Endpoint reference up to date: `pnpm check:docs`.
- Production health: `curl -s https://api.13-56-132-111.sslip.io/health`.
