# API

The backend's HTTP APIs, used by the Sugrpay web app, the public payment
pages, and the payment and accounting providers' webhooks. There are three,
each its own program
([decision 0005](../architecture/decisions/0005-separate-apis.md)): the
**platform** API (sign-in, companies, brands, users, subscriptions,
locations, Stripe/Square/Authorize.Net connections), the **Sugrpay** API
(customers, invoices, payments, checks, the payment page, brand settings,
dashboard, Zoho Books) and the **HQ** API (a skeleton: `/health` only).

| Read                                                   | For                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| This page                                              | How to call it: addresses, sign-in, errors, pagination, money |
| [endpoints.md](endpoints.md)                           | Every endpoint: which API, access rule, request, response     |
| `/docs` on any API ([openapi.json](openapi.json))      | Swagger: every endpoint's fields, and **Try it out**          |
| [test-report-2026-10-22.md](test-report-2026-10-22.md) | The last full check of every endpoint (before the split)      |

`endpoints.md` is generated from the controllers (`pnpm docs:api`), and
`pnpm check` fails when it is out of date — so it always matches the code.

## Swagger

Every API serves a Swagger page at **`/docs`**
(production: `https://api.sugrpay.com/docs`; locally:
`http://localhost:4001/docs`), over [openapi.json](openapi.json). It lists all
three APIs' endpoints with every request field (from the Zod schema the route
validates against: lengths, formats, enums), every response field (from the
handler's TypeScript return type) and the access each needs. **Try it out**
sends each request to the API that owns it; sign in with `POST /auth/login`,
then paste the `token` into **Authorize**.

`pnpm docs:api` writes `openapi.json` along with `endpoints.md`
(`scripts/openapi.mts`), and `pnpm check` fails when it is out of date. The
page's introduction is [swagger-intro.md](swagger-intro.md). Set
`API_DOCS_ENABLED=false` to turn the page off.

## Addresses

| Environment | Platform API                       | Sugrpay API                       | HQ API                       |
| ----------- | ---------------------------------- | --------------------------------- | ---------------------------- |
| Local       | `http://localhost:4001`            | `http://localhost:4002`           | `http://localhost:4003`      |
| Production  | `https://platform-api.sugrpay.com` | `https://sugrpay-api.sugrpay.com` | `https://hq-api.sugrpay.com` |

**Which API serves a path** is decided by `apiServiceFor` in
`packages/platform-contracts/src/api-routing.ts`. Sugrpay owns `/dashboard`,
`/public`, `/webhooks/zoho`, `/integrations/zoho`, `/health/queues` and
`/brands/:brandId/(checks|customers|invoices|payments|settings|integrations/zoho)`;
everything else is the platform's. [endpoints.md](endpoints.md) names the API
for every route.

In production, `https://api.sugrpay.com` is a **front door** that accepts every
path and passes it to the API that owns it, by the same rule. Locally there is
no front door: call each API on its own port.

There is no version prefix; the web app and the APIs deploy together.

## Signing in

Sessions belong to the platform API; the same token works on every API.

1. `POST /auth/login` (platform API) with `{ "email", "password" }` returns
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
  `curl -H "Authorization: Bearer dev0000…0dev" http://localhost:4001/auth/me`
  works without signing in (the full token is printed by the seed).

## Who may call what

Every request passes, in order:

1. **Session** — a valid token (`401` otherwise). The Sugrpay and HQ APIs ask
   the platform API who the token belongs to; if it cannot be reached they
   answer `503`.
2. **Product** — for Sugrpay routes, the company subscribes to Sugrpay and the
   user holds a Sugrpay role (`403`).
3. **Permission** — the user's role grants the route's `RESOURCE:ACTION`
   (listed per route in [endpoints.md](endpoints.md); the role matrix is in
   `packages/kernel/src/domain/roles.ts`) (`403`).
4. **Brand** — for `/brands/:brandId/…`, the brand is one the user can reach
   (`403`).
5. **Row-level security** in PostgreSQL — the database itself only returns rows
   of the user's company and brands, whatever the code above did.

A route that declares no permission is refused: access is opt-in, and each
API's `authorisation-coverage.test.ts` fails the build if a route forgets (or
if a route is served by an API `apiServiceFor` does not send it to).

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

| Status | Means                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| `400`  | The request is invalid — see the body below                                                                      |
| `401`  | No session, or it expired or was ended                                                                           |
| `403`  | Signed in, but not allowed (role, product or brand)                                                              |
| `404`  | Not found — or not yours, or a payment link that is no longer valid                                              |
| `409`  | Conflicts with the current state (e.g. paying a cancelled invoice)                                               |
| `503`  | Something it depends on is down (e.g. email could not be sent, or the platform API for a Sugrpay request); retry |
| `5xx`  | Other server errors; the error is in that API's log (`pm2 logs platform-api` or `pm2 logs sugrpay-api`)          |

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

`/internal/...` routes are for the APIs only: they need the shared
`INTERNAL_API_KEY`, and nginx refuses them from the internet.

## Trying it

```bash
# sign in (local demo data) — platform API
TOKEN=$(curl -s -X POST localhost:4001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@sugrpay.test","password":"sugrpay-dev-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# who am I, and my brands — platform API
curl -s localhost:4001/auth/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:4001/brands  -H "Authorization: Bearer $TOKEN"

# the dashboard — Sugrpay API
curl -s localhost:4002/dashboard/by-brand -H "Authorization: Bearer $TOKEN"
```
