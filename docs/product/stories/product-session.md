# Product Session — User Details & Tokens: design

How a product (HQ or Sugrpay) knows who is signed in, which Company they are
in and their role, and keeps calling platform APIs without the user signing
in again. Follows on from Select Your Products & Redirect
([company-onboarding.md](company-onboarding.md)).

## The flow

1. The user presses Continue. `POST /company/products/:product/continue`
   returns the product's `url`, a **JWT** with `expiresAt`, and a **refresh
   token** with `refreshExpiresAt`. The web app sends the user to
   `url#token=…&refreshToken=…` (the fragment never reaches a server log).
2. The product keeps both in local storage and sends the JWT as
   `Authorization: Bearer <JWT>` on every platform call.
3. `GET /product-session/me` returns the user, the Company ID, the role and
   the JWT's expiry. The product then asks for the Company's details and
   Brands with the Company ID (Company Profile story).
4. When the JWT expires, `POST /product-session/refresh` with
   `{ refreshToken }` returns a new JWT and `expiresAt`. When the refresh token
   has expired too, the user signs in again through the platform.

## Tokens

- **JWT:** HS256, signed with `PRODUCT_JWT_SECRET`. Claims: `sub` (user),
  `mid` (Company), `aud` (the product), `sid` (the product session), `iss`
  (`platform`), `iat`, `exp` (**12 hours**), random `jti`. Every refreshed JWT
  also lasts 12 hours.
- **Refresh token:** 32 random bytes (hex), lasting **30 days** (the story
  leaves the length open). It is stored only as a SHA-256 digest, in a
  `session` row with `product` set: the product session. It is not rotated on
  refresh.
- A refresh token is never accepted as a Bearer token, and a JWT is never
  accepted as a refresh token.

## Accepting the JWT on platform calls

The request guard's resolver (`SessionService.resolve`) accepts either a
platform session token or a product JWT. A JWT is accepted only when:

- the signature, issuer and audience (a product) check out, and it has not expired;
- its `sid` names a product session of the same user, Company and product,
  not revoked and not expired;
- the user is not suspended;
- the product is still enabled for the Company.

Anything else is a 401 with no details. The user's role, Brands and product
roles are read from the database on every call, so changes show at once. The
resulting scope carries `tokenProduct` and `tokenExpiresAt`. A product's JWT
is refused (403) on another product's endpoints (`productScope`).

## `GET /product-session/me`

Returns:

```json
{
  "user": { "id": "…", "name": "…", "email": "…" },
  "companyId": "…",
  "product": "HQ",
  "role": "COMPANY_ADMIN",
  "expiresAt": "2026-11-03T15:00:00.000Z"
}
```

- `role` is `COMPANY_ADMIN` for the Company Admin. For anyone else it is their
  role in the asking product only (HQ: `EXECUTIVE`, `MANAGER`, `ASSOCIATE`;
  Sugrpay: its six roles), never another product's.
- The user's details are those on the account. For a sign-up account, the email is the sign-in email.
- No Company details or Brands.
- Refusals:
  - a platform session (no product JWT): `403 PRODUCT_TOKEN_REQUIRED`;
  - a user with no role in the product: `403 NO_PRODUCT_ACCESS`.

## `POST /product-session/refresh` (public)

Body `{ "refreshToken": "…" }`. Returns `{ token, expiresAt }`.

- An expired refresh token gets `401 SIGN_IN_REQUIRED`.
- Any other refused token gets `401 INVALID_REFRESH_TOKEN`. That covers an unknown or revoked token, a platform session token, a product that is no longer enabled, and a suspended user.
- Rate limited.

Not part of this story: sign out, and what happens when a user or Company is
deactivated.

## Tests

`apps/platform/src/modules/auth/application/product-session.test.ts` has one
test per acceptance scenario, against the real database. It also covers:

- the refresh token refused as a Bearer token;
- a revoked session;
- a suspended user;
- a platform session asking for `me`;
- a JWT on another product's endpoints;
- JWTs forged for another user or product, or signed with the wrong secret.
