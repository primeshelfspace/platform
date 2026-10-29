# Company onboarding: design

Four stories, one flow on the platform API:

1. **Sign Up, Sign In, Forgot Password**
2. **Register Your Company**
3. **Add Your Brand**
4. **Select Your Products & Redirect**

They are platform stories. Companies, brands, users and products are shared
platform data, so the endpoints live on the platform API (`apps/platform`) and
in the main Swagger page (`/docs`), not in HQ. HQ and Sugrpay read this data
over HTTP, never from the platform database.

## The flow

```
Sign Up ──► Register Your Company ──► Add Your Brand ──► Select Your Products ──► product (with a JWT)
              (once per account)        (first brand)      (onboarding completes
                                                            when one is enabled)
```

The step is never stored. It is worked out from the data on every request, so
it cannot drift:

| Company registered? | Has an active Brand? | Step                                      |
| ------------------- | -------------------- | ----------------------------------------- |
| no                  | —                    | `REGISTER_COMPANY`                        |
| yes                 | no                   | `ADD_BRAND`                               |
| yes                 | yes                  | `SELECT_PRODUCTS` (also after onboarding) |

`GET /merchant/onboarding` returns it as `nextStep` (sign-up and each step's
own write return the next one too). Every write that belongs to a later step refuses (409) until the
earlier ones are done, so a step cannot be skipped by calling the API directly.

**Company Admin** is the account role `MERCHANT_OWNER`: the person who signed
up. Only they can register the company, add the first brand and enable
products. Any signed-in user of the company can see the products and continue
into an enabled one.

Companies that finished the old onboarding (they have a brand and an enabled
product) are complete: they land on Select Your Products, and nothing in their
data changes.

## 1. Sign Up, Sign In, Forgot Password

### `POST /auth/register` (public)

| Field      | Rule                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| `email`    | required; a valid address; trimmed, lower-cased; not a free email provider |
| `password` | required; the platform password rule: 12–200 characters                    |

- **Unique:** an address that has any account (any company, any status) is
  refused with `409 EMAIL_TAKEN`. One account belongs to one company.
- **Creates** the company (status active, contact email = the sign-up email)
  and its first user: role `MERCHANT_OWNER`, status active, the given password
  (hashed). No product is enabled; that happens in Select Your Products.
- **Signs the user in**: returns `{ token, expiresAt, user, nextStep:
"REGISTER_COMPANY" }`, the same shape as sign-in.
- Rate-limited per IP and per address. The attempt is written to the audit log.
- Every field is validated before anything is written: one failed check means
  nothing is created.

### `POST /auth/login` (public)

- Email and password only. Unknown email, wrong password and locked account
  answer the same `401`, so the response never reveals whether an email has an
  account.
- **Lockout:** 5 failed attempts in a row lock the account for **2 hours**.
  While locked, even the right password is refused (and does not extend the
  lock). A successful sign-in resets the count; so does the end of a lock (the
  next failure counts as the first).
- The web app then reads `GET /merchant/onboarding` and opens its `nextStep`.

### Forgot Password: unchanged

`POST /auth/forgot-password` (always `202`, never reveals whether the email has
an account; 3 requests per address per hour) and `POST
/auth/set-password/token` (a 64-character single-use token; expires; the new
password must meet the rule; the old password stops working and every other
session is signed out).

## 2. Register Your Company

### `POST /merchant/register-company` (Company Admin)

| Field            | Rule                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `companyName`    | required; 1–120 characters, trimmed; **unique across all companies**, ignoring case and repeated spaces |
| `legalName`      | required; 1–200 characters, trimmed                                                                     |
| `taxId`          | required; 1–64 characters, trimmed; letters, digits, spaces and `- . /` only                            |
| `brandStructure` | required; `SINGLE` or `MULTI`                                                                           |

- Contact email is the sign-up email; it is not a field.
- **Once per account:** a registered company answers `409
COMPANY_ALREADY_REGISTERED` and is left unchanged.
- **Name taken:** `409 COMPANY_NAME_TAKEN`, on the `companyName` field. A unique
  database index makes this hold even for two registrations at the same time.
- Returns `{ nextStep: "ADD_BRAND" }`.

## 3. Add Your Brand

### `POST /merchant/first-brand` (Company Admin)

| Field         | Rule                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `legalName`   | required; 1–200 characters, trimmed                                                                         |
| `displayName` | required; 1–120 characters, trimmed                                                                         |
| `currency`    | required; one of the supported currencies (USD, CAD, EUR, GBP, PKR)                                         |
| `timezone`    | required; a real IANA time zone (e.g. `America/New_York`), checked against the runtime's time zone database |
| `themeColor`  | optional; a hex colour (`#2D6A6A` or `2D6A6A`); the default colour if left out                              |

- **Company not registered:** `409 COMPANY_NOT_REGISTERED`.
- **One brand in this step:** a company that already has a brand answers `409
BRAND_ALREADY_ADDED`. More brands come later from Brand Management. The brand
  structure chosen at registration does not change this.
- The brand is **active**. Its email and tax ID come from the company. Every
  product hears about it (`brand.created`) before the call returns.
- Returns `{ brand: { id, displayName }, nextStep: "SELECT_PRODUCTS" }`.

## 4. Select Your Products & Redirect

### `GET /company/products` (any signed-in user)

The fixed list, HQ and Sugrpay, each with `product`, `name`, `description`,
`enabled`, and `canEnable` (Company Admin and not enabled yet). Also
`onboardingComplete`.

### `POST /company/products` (Company Admin)

Body `{ products: ["INVOICING", "HQ"] }`: at least one, no repeats.

- Before the company is registered: `409 COMPANY_NOT_REGISTERED`. Before it has
  an active brand: `409 ADD_BRAND_FIRST`.
- Enables exactly the products sent; others are untouched. Enabling one already
  enabled is not an error. The Company Admin gets that product's top role
  (Sugrpay: their account role; HQ: `EXECUTIVE`).
- Completes onboarding (it stays complete).
- Returns the list, plus `continueWith`: the product to open straight away when
  exactly one is enabled, otherwise `null` (the user picks with Continue).
- An empty list is a validation error: nothing is enabled and onboarding stays
  incomplete.

### `POST /company/products/:product/continue` (any signed-in user)

- Product not enabled for the company: `409 PRODUCT_NOT_ENABLED`, and no token.
- Product with no web address configured (HQ until `HQ_PUBLIC_URL` is set):
  `409 PRODUCT_NOT_AVAILABLE`.
- Otherwise returns `{ url, token, expiresAt }`. `token` is a JWT (HS256, signed
  with `PRODUCT_JWT_SECRET`) with `sub` (user), `mid` (company), `aud` (product),
  `iss` (`platform`), `iat`, `exp` (15 minutes) and a random `jti`. The web app
  sends the user to `url`, carrying the token in the URL fragment so it never
  reaches a server log. How the product keeps and refreshes it is the Product
  Session story.

## Security

- **Company isolation:** every company-owned row is read and written through
  row-level security (`withScope`). The only unscoped reads are sign-up's
  global email check and the company-name uniqueness check, which return
  nothing but "taken".
- **No skipping:** each step's endpoint checks the earlier steps on the server.
- **Role checks:** writes check the role on the server, not just in the UI.
- **Passwords:** hashed; never logged or returned. Sign-in failures are
  indistinguishable.
- **Tokens:** a product JWT is issued only for an enabled product, is
  short-lived, and travels in the URL fragment.
- **Input:** every body is validated by a Zod schema before any write;
  unknown fields are ignored.

## Tests

Each acceptance scenario has a test against a real database, plus:

- free-provider email; email taken by a user in another company; email in any case;
- 4 failures then success resets the count; the fifth failure locks; correct
  password while locked; sign-in after the lock ends;
- company name taken with different case or spacing; two registrations racing
  for one name;
- every required field missing in turn; invalid currency and time zone; theme
  colour absent; brand when the company is not registered; a second brand;
- enabling with no brand; empty and repeated product lists; enabling by a
  non-admin; enabling twice; `continueWith` for one and two products;
  continuing into a product that is not enabled, and into HQ with no address;
- another company's user can see none of it.
