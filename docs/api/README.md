# API

The backend's HTTP API: one NestJS service used by the Sugrpay web app, the
public payment pages, and the payment and accounting providers' webhooks.

| Read                                                   | For                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| This page                                              | How to call it: addresses, sign-in, errors, pagination, money |
| [endpoints.md](endpoints.md)                           | Every endpoint: access rule, request, response, what it does  |
| [test-report-2026-10-22.md](test-report-2026-10-22.md) | The last full check of every endpoint, with findings          |

`endpoints.md` is generated from the controllers (`pnpm docs:api`), and
`pnpm check` fails when it is out of date — so it always matches the code.

## Addresses

| Environment | API                                  |
| ----------- | ------------------------------------ |
| Local       | `http://localhost:4000`              |
| Production  | `https://api.13-56-132-111.sslip.io` |

There is no version prefix; the web app and the API deploy together.

## Signing in

1. `POST /auth/login` with `{ "email", "password" }` returns
   `{ "token", "expiresAt", "user" }`.
2. Send the token on every other call:
   `Authorization: Bearer <token>`. (The API also accepts it in the
   `sugrpay_session` cookie; the web app sends the header.)
3. `POST /auth/logout` ends the session.

- Sessions last **12 hours**. An expired or ended session gets `401`.
- **5 wrong passwords in 15 minutes lock the account for 30 minutes.**
- Only a SHA-256 hash of the token is stored; a database leak does not leak
  sessions.
- Locally, `pnpm db:seed` creates a fixed session for the demo owner, so
  `curl -H "Authorization: Bearer dev0000…0dev" http://localhost:4000/auth/me`
  works without signing in (the full token is printed by the seed).

## Who may call what

Every request passes, in order:

1. **Session** — a valid token (`401` otherwise).
2. **Product** — for Sugrpay routes, the company subscribes to Sugrpay and the
   user holds a Sugrpay role (`403`).
3. **Permission** — the user's role grants the route's `RESOURCE:ACTION`
   (listed per route in [endpoints.md](endpoints.md); the role matrix is in
   `packages/kernel/src/domain/roles.ts`) (`403`).
4. **Brand** — for `/brands/:brandId/…`, the brand is one the user can reach
   (`403`).
5. **Row-level security** in PostgreSQL — the database itself only returns rows
   of the user's company and brands, whatever the code above did.

A route that declares no permission is refused: access is opt-in, and a test
(`authorisation-coverage.test.ts`) fails the build if a route forgets.

## Requests

- Bodies are JSON (`Content-Type: application/json`), except uploads, which are
  `multipart/form-data` (logos: field `file`, up to 5 MB; check images: fields
  `front` and `back`, up to 10 MB each).
- Every body and query string is validated against a schema in
  `packages/*-contracts/src/schemas.ts` (named per route in
  [endpoints.md](endpoints.md)). Unknown fields are ignored.
- IDs are UUIDs. Dates are ISO 8601 (`2026-10-22` or
  `2026-10-22T10:00:00.000Z`).

### Money

- **Responses** carry money as integer **minor units** (cents) in fields ending
  `Minor` — `totalMinor: 12550` is $125.50 — never as floating point.
- **Requests** carry amounts the way people type them, as decimal strings —
  `"unitPrice": "50.00"`, `"amount": "15.00"` — and the server converts them
  against the invoice's currency.
- Rates are **basis points** (`taxRateBp: 875` = 8.75%).

### Lists

List endpoints take `?page=1&pageSize=25` (`pageSize` 1–200) and return:

```json
{ "data": [ … ], "page": 1, "pageSize": 25, "total": 8 }
```

## Errors

| Status | Means                                                               |
| ------ | ------------------------------------------------------------------- |
| `400`  | The request is invalid — see the body below                         |
| `401`  | No session, or it expired or was ended                              |
| `403`  | Signed in, but not allowed (role, product or brand)                 |
| `404`  | Not found — or not yours, or a payment link that is no longer valid |
| `409`  | Conflicts with the current state (e.g. paying a cancelled invoice)  |
| `5xx`  | Our fault; the error is in the API log (`pm2 logs api`)             |

Error bodies:

```json
{ "statusCode": 404, "error": "Not Found", "message": "invoice not found" }
```

Validation errors list every problem:

```json
{
  "message": "validation failed",
  "issues": [{ "path": "subject", "message": "Required", "code": "invalid_type" }]
}
```

## Public endpoints

No sign-in, but each is protected another way:

| Endpoints                       | Protected by                                                |
| ------------------------------- | ----------------------------------------------------------- |
| `/public/invoices/:token/…`     | The 32-character random token in the invoice's payment link |
| `/public/webhooks/stripe`       | Stripe's signature (`STRIPE_WEBHOOK_SECRET`)                |
| `/public/webhooks/fake-gateway` | The active gateway's signature — Stripe's in production     |
| `/webhooks/zoho/*`              | A per-organisation token in the URL                         |
| `/integrations/*/callback`      | A signed, expiring OAuth `state`                            |
| `/storage/local`                | A signed, expiring link (only used with local-disk storage) |
| `/health*`                      | Nothing to protect: status only, no data                    |

## Trying it

```bash
# sign in (local demo data)
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@sugrpay.test","password":"sugrpay-dev-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# who am I, and my brands
curl -s localhost:4000/auth/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/brands  -H "Authorization: Bearer $TOKEN"
```
