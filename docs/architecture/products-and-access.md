# Products and access

How a person gets into a product: one sign-in, a company subscription, a role
in that product, and the brands and locations they can see. This is phase 2
of the architecture plan.

## The four checks

Every request to a product endpoint (anything served by the Sugrpay API,
`apps/sugrpay`, and later the HQ API, `apps/hq`) passes these, in order,
inside `AuthorisationGuard` (`@platform/server`):

| #   | Check                                       | Where it comes from                                 | Fails with |
| --- | ------------------------------------------- | --------------------------------------------------- | ---------- |
| 1   | Signed in                                   | the shared session cookie / bearer token            | 401        |
| 2   | The company subscribes to the product       | `subscription` (status `ACTIVE`)                    | 403        |
| 3   | The user holds a role in the product        | `user_product_role`                                 | 403        |
| 4   | That role may do this action, on this brand | the permission matrix (`@platform/kernel` roles.ts) | 403        |

Checks 2 and 3 come from one lookup in the platform database
(`app_resolve_session`) that runs on every request — a product API asks for it
over the platform's `POST /internal/sessions/resolve` — so turning a product
off or taking someone's role away takes effect on their **next** request.

A product controller declares its product once, on the class:

```ts
@ProductScope('INVOICING')
@Controller('brands/:brandId/invoices')
export class InvoicesController { … }
```

Each API's `authorisation-coverage.test.ts` fails the build if any product
controller forgets it, or if a platform controller has one.

## Subscriptions

`subscription` holds one row per company and product. Billing is not connected
to a payment provider yet, so an owner switches products on and off in
**Accounts → Billing** (`PUT /company/subscriptions/:product`). Each change
publishes `platform.subscription.changed`.

A new company gets Sugrpay (`INVOICING`) at sign-up. Existing companies were
given it by the migration that introduced subscriptions.

## Roles per product

A person holds **one role per product**, independently:

| Product             | Roles                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Sugrpay (INVOICING) | Merchant Owner, Merchant Admin, Brand Admin, Finance User, Sales User, Read Only |
| HQ                  | Executive, Manager, Associate                                                    |

So a bookkeeper can be _Finance User_ in Sugrpay and have no HQ access at all.

- The Sugrpay role **is** the user's account role (`user.role`) — the two are
  kept in step, so the existing permission matrix keeps working unchanged.
  For a Sugrpay request the guard uses the Sugrpay role for the matrix.
- HQ roles are granted by an Owner or Merchant Admin only. HQ has no
  permission matrix yet; its requests keep the account role for the matrix and
  carry the HQ role in `scope.productRoles.HQ`.

Endpoints: `PUT /users/:id/product-roles/:product` (`{ "role": "MANAGER" }`, or
`{ "role": null }` to remove HQ access). `GET /auth/me` lists the products the
user can open, with their role in each.

## Brands and locations

Brands work as before: Owner and Merchant Admin see every brand; everyone else
sees the brands assigned to them.

**Locations** are stores and warehouses (`location`, kind `STORE` or
`WAREHOUSE`). A location belongs to the company and may serve one brand. Who
sees a location — enforced by row-level security (`location_scope`):

- Owner and Merchant Admin: every location.
- Everyone else: the locations of the brands they can reach (**extended
  scope**), plus any location assigned to them directly
  (`user_location_assignment`, `PUT /users/:id/locations`).

The request scope carries `assignedLocationIds`, and the database receives
`app.location_ids` / `app.all_locations` next to the brand settings. Location
changes publish `platform.location.created` / `platform.location.updated`, so
HQ can keep its own copy later.

## One sign-in for every app

People sign in on **Accounts** (`apps/accounts` in the sugrpay-frontend
repository, port 3002). The session token
is stored in one httpOnly cookie, `platform_session`
(`@platform/platform-contracts` `session.ts`), which every web app reads and
replays to the API:

- **Locally** all apps run on `localhost`, and browsers share cookies across
  ports, so nothing needs configuring.
- **In production** the apps live on subdomains. Set `COOKIE_DOMAIN` to the
  parent domain (for example `.primeshelfspace.com`) so the cookie reaches all
  of them.

A product app never shows its own sign-in page. Its middleware forwards
`/login`, `/signup`, `/set-password`, `/forgot-password`, `/check-inbox`,
`/terms` and `/privacy` to Accounts, with the page the user was on as `next`.
Accounts sends them back there afterwards — only to one of the platform's own
apps (`safeReturnTo`), never to another site. Signing out anywhere clears the
shared cookie, which signs the user out of every app.

A signed-in user without access to Sugrpay (no subscription, or no Sugrpay
role) who opens the Sugrpay app is sent back to the Accounts product launcher.

## What Accounts does

| Page      | For                                                                                            | Who sees it                   |
| --------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Products  | The launcher: every product, and whether you can open it                                       | everyone                      |
| Team      | Invite people; set their Sugrpay and HQ roles, brands, locations, status                       | Owner, Admin, Brand Admin     |
| Brands    | The company's brands (adding one happens in Sugrpay, which also sets up its invoice numbering) | everyone                      |
| Locations | Add, archive and restore stores and warehouses                                                 | everyone (edit: Owner, Admin) |
| Billing   | Turn products on and off                                                                       | Owner                         |
