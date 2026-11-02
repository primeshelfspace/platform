# Product company APIs: design

The platform APIs a product (HQ or Sugrpay) calls to read and manage its
Company. Five stories:

- Company Profile — Company Details & Brands
- Brand Management — add, edit, archive Brands
- User Management — Users, Roles & Access
- User Management — User List
- Role Management — Role List

Every endpoint takes the product's **JWT** from
[Product Session](product-session.md) as a Bearer token. The platform knows
from it the user, the Company and the asking product, so none of them is sent
(Company Profile also takes the Company ID, and checks it). The request guard
refuses (401) an invalid or expired JWT, or a product no longer enabled for
the Company, before any handler runs. A platform session without a product JWT
gets `403 PRODUCT_TOKEN_REQUIRED`.

Code: `apps/platform/src/modules/product-company/`.

## Who may do what

- **Company Admin:** the account that signed the Company up (`MERCHANT_OWNER`). It has company-level access, so every Brand is assigned to it automatically. It appears as role `COMPANY_ADMIN`.
- **Everyone else:** they see only the Brands assigned to them. Their role is their role in the asking product.
- Brand Management, User Management, the User List and the Role List are for the Company Admin only (`403` for anyone else).
- Company Profile is for any signed-in user.

## Company Profile — `GET /companies/:companyId`

Returns `{ company, brands }`:

- `company`: `id`, `companyName`, `legalName`, `taxId`, `brandStructure`, `status`, `contactEmail`. The contact email is the sign-up email.
- `brands`: the Brands this user can access, each with:
  - `id`, `legalName`, `displayName`, `currency`, `timezone`;
  - `themeColor`, which is `null` when none has been set;
  - `status` (`ACTIVE` or `ARCHIVED`) and `archived`.
  - Archived Brands are included.

No role and no Locations. Read fresh every time. Any other Company's ID gets `403 NOT_YOUR_COMPANY`, and nothing else is returned.

Theme Color is now optional in the database. A Brand added without one has none, where it used to get `#2D6A6A`. Brand Settings and the copy of the Brand sent to products still show `DEFAULT_BRAND_THEME_COLOR` when it is unset.

## Brand Management

| Call                                    | What it does                                                |
| --------------------------------------- | ----------------------------------------------------------- |
| `POST /company/brands`                  | Adds a Brand; returns `{ id, displayName, status }`, active |
| `PUT /company/brands/:brandId`          | Edits it; returns the Brand                                 |
| `POST /company/brands/:brandId/archive` | Marks it archived; returns the Brand                        |

- **Required:** Legal Name, Display Name, Currency and Timezone, each a valid value. Theme Color is optional. These are the same rules as Add Your Brand (`firstBrandSchema`).
- **Display Name:** unique within the Company, ignoring case and extra spaces (`409 DISPLAY_NAME_TAKEN`, issue on `displayName`). Another Company can use the same name.
- **Editing:** follows the same rules. A Brand can keep its own Display Name.
- **Concurrency:** writes take a lock on the Company row, so two adds cannot both pass the name check.
- **Brand Structure** does not limit how many Brands there are. Registering a Company creates no Brand.
- **Another Company's Brand:** refused (`403` from the request guard, which checks a `:brandId` belongs to the Company), and nothing changes.
- **Events:** every change sends `platform.brand.created` or `platform.brand.updated`, so products holding a copy keep in step.

## User Management

| Call                                     | What it does                                 |
| ---------------------------------------- | -------------------------------------------- |
| `POST /company/users`                    | Adds an active user; returns the user        |
| `PUT /company/users/:userId`             | Edits details, role and Brands (no password) |
| `POST /company/users/:userId/deactivate` | Deactivates them                             |
| `POST /company/users/:userId/reactivate` | Makes a deactivated user active again        |

Every user is returned as:

- `id`, `name`, `email`;
- `phone`: `{ country, countryCode, number, e164 }`, or `null` for older accounts;
- `role`;
- `brands`: `[{ id, displayName, archived }]`;
- `status`: `ACTIVE`, `INVITED` or `DEACTIVATED`.

Rules:

- **All required:** name, email, phone, first password, role, and at least one Brand.
- **Email:** a valid address, unique across the platform in any case (`409 EMAIL_TAKEN`). The check takes the same lock as Sign Up, so a sign-up and an add can't both take the same address.
- **Phone:** `{ country: "US", number: "…" }`, valid for that country (`400 PHONE_INVALID`). Stored as the ISO country plus E.164 (new columns `user.phone_country` and `user.phone_number`).
- **Password:** the platform's rules (at least 12 characters).
- **Role:** one of the Role List for the asking product (`400 ROLE_NOT_AVAILABLE`).
- **Brands:** Brands of the Company (`400 BRAND_NOT_IN_COMPANY`).
- **Signing in:** the user signs in with their email and the password the Company Admin set.
- **Sugrpay's role is also the user's platform role.** A user added from HQ gets the platform's least role (`READ_ONLY`): it is only for signing in and reading their own Company, and their HQ role carries their access.
- **Deactivating:** sets the account to `SUSPENDED`. They cannot sign in, their sessions end at once (any product JWT stops working), and their records are kept. **Reactivating** makes them `ACTIVE` again.
- **The Company Admin's own account** is not managed here:
  - deactivating it gets `403 CANNOT_DEACTIVATE_SELF`;
  - editing it gets `409 COMPANY_ADMIN_ACCOUNT`.
- **Another Company's user:** `404`, and nothing changes.

## User List — `GET /company/users?brandId=`

- Returns all of the Company's users, deactivated ones included, in the same shape as above.
- `role` is the asking product's role only, or `null` when they hold none there.
- **With `brandId`:** only users assigned to that Brand, plus the Company Admin, who is under every Brand.
  - A Brand with nobody else assigned returns just the Company Admin.
  - Another Company's Brand gets `404`.

Note: a user whose platform role covers every brand (Sugrpay's Admin) but who has no Brand assigned shows no Brands here. The stories give every user other than the Company Admin their assigned Brands only.

## Role List — `GET /company/roles`

The asking product's fixed roles, the same for every Company. The Company Admin is not in the list.

- **HQ:** `EXECUTIVE` (Executive), `MANAGER` (Manager), `ASSOCIATE` (Associate).
- **Sugrpay:** `MERCHANT_ADMIN` (Admin), `BRAND_ADMIN` (Brand Admin), `FINANCE_USER` (Finance User), `SALES_USER` (Sales User), `READ_ONLY` (Read Only). Its sixth role, Owner, is the Company Admin.

Each entry is `{ id, name }`. User Management takes the `id` as `role`.

## Tests

- `product-company/application/product-company.test.ts`: one test per acceptance scenario, against the real database, using scopes resolved from real product JWTs.
- `packages/platform-contracts/src/product-company-schemas.test.ts`: the request validation.
