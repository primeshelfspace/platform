# Swagger introduction

<!-- The text at the top of the Swagger page (/docs). scripts/openapi.mts reads
     everything below the first heading into docs/api/openapi.json. -->

Every endpoint of the three APIs: **platform** (sign-in, companies, brands, team, locations, payment-gateway connections), **Sugrpay** (customers, invoices, payments, checks, brand settings, dashboard, Zoho Books, the public payment page) and **HQ** (health only, so far). Each operation says which API serves it and the access it needs.

This document is generated from the code (`pnpm docs:api`), so it always matches what the API does. The guide is [docs/api/README.md](https://github.com/primeshelfspace/platform/blob/main/docs/api/README.md).

## Addresses

In production, `api.sugrpay.com` accepts every path and passes it on to the API that owns it, so **Try it out** works for every endpoint from this page. Locally, each API runs on its own port (platform 4001, Sugrpay 4002, HQ 4003); this page sends each request to the right one.

## Signing in

1. Call `POST /auth/login` with `{ "email", "password" }` (Try it out). It returns `{ token, expiresAt, user }`.
2. Click **Authorize** and paste the `token` under **bearerAuth**. Every signed-in request then carries `Authorization: Bearer <token>`.
3. `POST /auth/logout` ends the session.

Sessions last 12 hours. Five wrong passwords in 15 minutes lock the account for 30 minutes.

## Who may call what

A signed-in request passes, in order: a valid **session** (`401`), the company's **product** subscription for Sugrpay routes (`403`), the role's **permission** (`RESOURCE:ACTION`, shown on each operation) (`403`), and for `/brands/{brandId}/…` a **brand** the user can reach (`403`).

## Conventions

- **Money in responses** is integer minor units in fields ending `Minor` (`totalMinor: 12550` is $125.50). **Money in requests** is a decimal string, as typed (`"unitPrice": "50.00"`). Rates are basis points (`taxRateBp: 875` is 8.75%).
- **IDs** are UUIDs. **Dates** are ISO 8601.
- **Lists** take `?page=1&pageSize=25` (`pageSize` 1–200) and return `{ data, page, pageSize, total }`.
- **Errors** are `{ statusCode, error, message }`; validation errors are `{ message: "validation failed", issues: [{ path, message, code }] }`.
- **Public** routes need no sign-in but are protected another way: the payment-link token, a provider's signature, a signed OAuth `state` or a signed file link.
- **Internal** routes (`/internal/…`) are for the APIs only; nginx refuses them from the internet.
