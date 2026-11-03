# HQ Swagger introduction

<!-- The text at the top of the HQ Swagger page (/hq/docs). scripts/openapi.mts
     reads everything below the first heading into docs/api/hq-openapi.json. -->

Every API the **HQ** product uses, in the order you meet them: signing up and onboarding in Accounts, the Product Session, then the Company APIs HQ calls with its JWT. Each operation has the story it comes from, when to call it, a request and response example, and every error it can return with its `code`.

This page is generated from the code (`pnpm docs:api`), like the main reference at [/docs](/docs), so it always matches what the API does. The design notes are in the repository: [product-session.md](https://github.com/primeshelfspace/platform/blob/main/docs/product/stories/product-session.md) and [product-company-apis.md](https://github.com/primeshelfspace/platform/blob/main/docs/product/stories/product-company-apis.md).

## The flow

1. **Accounts** (group 1). The person signs up (`POST /auth/register`) or signs in (`POST /auth/login`) and gets an **Accounts session token**. Onboarding, in order:
   - Register Your Company;
   - Add Your Brand;
   - Select Your Products, enabling HQ.
2. **Continue into HQ** (`POST /company/products/HQ/continue`). This returns HQ's address, a **JWT** (12 hours) and a **refresh token** (30 days). The browser goes to `https://<hq>#token=<JWT>&refreshToken=<refresh token>`.
3. **HQ starts.** It reads both tokens from the URL fragment, keeps them in local storage and clears the fragment. Then:
   - `GET /product-session/me` gives the user, `companyId` and role;
   - `GET /companies/{companyId}` gives the Company and the user's Brands.
4. **HQ works.** Every call sends `Authorization: Bearer <JWT>`. The Company Admin manages Brands, users and roles (groups 4–6).
5. **When the JWT expires**, `POST /product-session/refresh` returns a new one. When the refresh token has expired too (`401 SIGN_IN_REQUIRED`), the user signs in again through Accounts.

## Trying it on this page

1. `POST /auth/login` (Try it out) returns `token`. Click **Authorize**, paste it under **accountsSession**, and close.
2. `POST /company/products/{product}/continue` with `product` = `HQ` returns the HQ `token`. Paste it under **productJwt** in **Authorize**.
3. Every HQ call on this page now sends the JWT.

Until HQ has a web address on the server (`HQ_PUBLIC_URL`), Continue into HQ answers `409 PRODUCT_NOT_AVAILABLE`. To try groups 2–6 before then, continue into `INVOICING` instead: the same APIs answer, with Sugrpay's roles in place of HQ's.

## Two tokens

| Token                     | Comes from                                        | Used for                             | Lasts    |
| ------------------------- | ------------------------------------------------- | ------------------------------------ | -------- |
| **Accounts session**      | `POST /auth/login`, `POST /auth/register`         | Group 1 (onboarding, Continue)       | 12 hours |
| **HQ JWT** (`productJwt`) | Continue into HQ, `POST /product-session/refresh` | Groups 2–6                           | 12 hours |
| **Refresh token**         | Continue into HQ                                  | `POST /product-session/refresh` only | 30 days  |

- The JWT names the user, the Company and the product, so HQ never sends a user ID or a Company ID. Company Profile is the exception: it takes the Company ID and checks it.
- The platform refuses a JWT that is invalid or expired, whose session has ended, or for a product the Company no longer has enabled.
- The refresh token is never accepted as a Bearer token.
- An Accounts session token on an HQ endpoint gets `403 PRODUCT_TOKEN_REQUIRED`.

## Who may do what

- **Company Admin:** the account that signed the Company up. It has company-level access, so all of the Company's Brands are its automatically, and it shows as role `COMPANY_ADMIN`. Only the Company Admin manages Brands and users and reads the user and role lists.
- **Everyone else:** they hold one **HQ role** (`EXECUTIVE`, `MANAGER` or `ASSOCIATE`) and see only the Brands **assigned** to them. Their Sugrpay role, if any, is never returned to HQ.
- **Isolation:** a Company never sees or changes another Company's data. A Brand or user of another Company is refused (`403` or `404`), and nothing about it is returned.

## Errors

- Errors are `{ statusCode, error, message }`. Many also carry a `code`, listed on each operation. Branch on `code`, not on `message`.
- Validation errors are `400 { message: "validation failed", issues: [{ path, message, code }] }`, one issue per field problem. Show them next to their fields.
- Field errors the API finds against its data (`EMAIL_TAKEN`, `PHONE_INVALID`, `ROLE_NOT_AVAILABLE`, `BRAND_NOT_IN_COMPANY`, `DISPLAY_NAME_TAKEN`) carry the same `issues` list, naming the field.

| Status | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| `400`  | The request is invalid (see `issues`).                                               |
| `401`  | No valid token. For the JWT: refresh, then retry once; else sign in again.           |
| `403`  | Signed in, but not allowed: not the Company Admin, wrong token, or not your Company. |
| `404`  | Not found, or not yours.                                                             |
| `409`  | Conflicts with existing data (a name or email taken, a step done or not done yet).   |
| `429`  | Too many requests: wait and retry.                                                   |

## Conventions

- **IDs** are UUIDs. **Dates** are ISO 8601, UTC.
- **Currency** is an ISO 4217 code (`USD`), and a **timezone** is an IANA name (`America/New_York`).
- **Colors** are `#RRGGBB`. A **phone** is `{ country: "US", number }`, returned with its dialling code and E.164 form.
- **Lists** are returned whole. Ask again whenever you need fresh data: every answer reflects the latest roles, Brands and users.

## Coming next

HQ's own APIs will be added to this page as they are built, from their stories:

- Locations (stores and warehouses);
- the product catalog;
- stock;
- purchase orders and receiving;
- transfers;
- sales-channel sync.
