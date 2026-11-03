/**
 * The HQ API reference: which endpoints HQ uses, in the order a developer
 * meets them, with the detail the HQ Swagger page (/hq/docs) shows on top of
 * what scripts/openapi.mts generates from the code — when to call each one,
 * a request and response example, and every error it can return.
 *
 * scripts/openapi.mts builds docs/api/hq-openapi.json from the generated
 * operations plus this file, and fails if an endpoint listed here does not
 * exist (or changes shape) in the code. Add HQ's own endpoints here as they
 * are built.
 */

const COMPANY_ID = '7876d1ee-36c2-4e64-a583-9ff50657f8b1';
const USER_ID = '15b43278-6e25-46f5-956e-b620577f484b';
const BRAND_ID = '65dcd015-b48d-4ea3-98bc-28188c086226';
const BRAND_ID_2 = '84dace18-1b14-4b7e-9e28-185ee9c0b03a';
const MEMBER_ID = '3f9c2a10-6b1e-4f7d-8a55-0c2e9d4b7a61';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtaWQiOiI3ODc2ZDFlZS0uLi4iLCJzaWQiOiIuLi4iLCJpc3MiOiJwbGF0Zm9ybSIsImF1ZCI6IkhRIiwic3ViIjoiMTViNDMyNzgtLi4uIn0.signature';
const REFRESH = '9f2c6d0b8e1a4f7c3b5d9e0a2c4f6b8d1e3a5c7f9b0d2e4a6c8f0b2d4e6a8c0f';
const SESSION = 'a3f9c1e7b5d2049e8f6a1c3b5d7e9f0a2c4e6b8d0f1a3c5e7b9d1f3a5c7e9b0d';

const company = {
  id: COMPANY_ID,
  companyName: 'Acme Coffee Group',
  legalName: 'Acme Coffee Group LLC',
  taxId: '12-3456789',
  brandStructure: 'MULTI',
  status: 'ACTIVE',
  contactEmail: 'dana@acmecoffee.com',
};
const brand = {
  id: BRAND_ID,
  legalName: 'Acme Coffee LLC',
  displayName: 'Acme Coffee',
  currency: 'USD',
  timezone: 'America/New_York',
  themeColor: '#2D6A6A',
  status: 'ACTIVE',
  archived: false,
};
const member = {
  id: MEMBER_ID,
  name: 'Riley Stone',
  email: 'riley@acmecoffee.com',
  phone: { country: 'US', countryCode: '+1', number: '2025550143', e164: '+12025550143' },
  role: 'MANAGER',
  brands: [{ id: BRAND_ID, displayName: 'Acme Coffee', archived: false }],
  status: 'ACTIVE',
};
const signedInUser = {
  id: USER_ID,
  merchantId: COMPANY_ID,
  email: 'dana@acmecoffee.com',
  name: 'dana',
  role: 'MERCHANT_OWNER',
  mustResetPassword: false,
};
const productCards = [
  {
    product: 'INVOICING',
    name: 'Sugrpay',
    description: 'Invoices, payments and collections for every brand.',
    enabled: false,
    canEnable: true,
  },
  {
    product: 'HQ',
    name: 'HQ',
    description: 'Run your stores and warehouses: inventory, purchasing and team, in one place.',
    enabled: true,
    canEnable: false,
  },
];

/** Errors every product-JWT endpoint shares (the request guard's). */
const JWT_ERRORS = [
  {
    status: 401,
    message: 'authentication required',
    when: 'No JWT, or it is invalid, expired, or its product session ended; or HQ is no longer enabled for the Company. Refresh the JWT (POST /product-session/refresh) and retry once.',
  },
  {
    status: 403,
    code: 'PRODUCT_TOKEN_REQUIRED',
    message: "call this with the product's JWT",
    when: 'Called with an Accounts (platform) session token instead of the HQ JWT.',
  },
];
const ADMIN_ONLY = {
  status: 403,
  message: 'only the Company Admin can do this',
  when: 'The signed-in user is not the Company Admin.',
};
const ACCOUNTS_401 = {
  status: 401,
  message: 'authentication required',
  when: 'No Accounts session token, or it expired (12 hours) or was signed out.',
};

/** Groups, in the order they appear on the page. */
export const HQ_GROUPS = [
  {
    name: '1. Accounts: sign up and onboarding',
    description:
      'Before HQ: the Accounts web app signs the person up, registers the Company, adds its first Brand and enables HQ, then sends the user into HQ with a JWT. These calls use the **Accounts session token** (`accountsSession`), not the HQ JWT. Stories 1–4.',
    routes: [
      'POST /auth/register',
      'POST /auth/login',
      'POST /auth/forgot-password',
      'POST /auth/set-password/token',
      'GET /merchant/onboarding',
      'POST /merchant/register-company',
      'POST /merchant/first-brand',
      'GET /company/products',
      'POST /company/products',
      'POST /company/products/:product/continue',
    ],
  },
  {
    name: '2. Product Session',
    description:
      'HQ arrives with a 12-hour JWT and a refresh token. Ask who is signed in, and refresh the JWT when it expires. Story 5.',
    routes: ['GET /product-session/me', 'POST /product-session/refresh'],
  },
  {
    name: '3. Company Profile',
    description: "The Company's details and the Brands the user can access. Story 6.",
    routes: ['GET /companies/:companyId'],
  },
  {
    name: '4. Brand Management',
    description: 'The Company Admin adds, edits and archives Brands from HQ. Story 7.',
    routes: [
      'POST /company/brands',
      'PUT /company/brands/:brandId',
      'POST /company/brands/:brandId/archive',
    ],
  },
  {
    name: '5. User Management',
    description:
      "The Company Admin lists, adds, edits, deactivates and reactivates the Company's users. Stories 8 and 9.",
    routes: [
      'GET /company/users',
      'POST /company/users',
      'PUT /company/users/:userId',
      'POST /company/users/:userId/deactivate',
      'POST /company/users/:userId/reactivate',
    ],
  },
  {
    name: '6. Role List',
    description: "HQ's roles, for choosing one when adding or editing a user. Story 10.",
    routes: ['GET /company/roles'],
  },
  {
    name: '7. Service',
    description: 'Whether the API is up.',
    routes: ['GET /health'],
  },
];

/**
 * Per endpoint: `auth` (`jwt`, `accounts` or `public`), `story`, a `guide`
 * (markdown: when and how to call it), `request` and `response` examples, and
 * `errors` (status, optional code, message, when).
 */
export const HQ_DETAILS = {
  // --- 1. Accounts ------------------------------------------------------
  'POST /auth/register': {
    auth: 'public',
    story: 'Sign Up, Sign In, Forgot Password',
    guide: `Creates the account with a **company email** (not a personal provider such as Gmail) and a password of at least 12 characters. The person becomes the **Company Admin** of a new Company.

Returns an **Accounts session token** (12 hours) and \`nextStep: REGISTER_COMPANY\`. Use the token as \`accountsSession\` for the rest of onboarding.`,
    request: { email: 'dana@acmecoffee.com', password: 'a long enough password' },
    response: {
      token: SESSION,
      expiresAt: '2026-11-04T02:00:00.000Z',
      user: signedInUser,
      nextStep: 'REGISTER_COMPANY',
    },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'Email missing, not an email, or from a personal provider; password shorter than 12 characters.',
      },
      {
        status: 409,
        code: 'EMAIL_TAKEN',
        message: 'an account with this email address already exists',
        when: 'An account (in any Company) already uses this email, in any case.',
      },
    ],
  },
  'POST /auth/login': {
    auth: 'public',
    story: 'Sign Up, Sign In, Forgot Password',
    guide: `Signs in with email and password. Returns an **Accounts session token** (12 hours).

Then call \`GET /merchant/onboarding\`: when \`nextStep\` is not \`SELECT_PRODUCTS\` with onboarding complete, the user finishes onboarding first.

**Lockout:** 5 wrong passwords in a row lock the account for 2 hours, even against the right password. Every failure answers the same, so it never tells whether the email exists.`,
    request: { email: 'dana@acmecoffee.com', password: 'a long enough password' },
    response: { token: SESSION, expiresAt: '2026-11-04T02:00:00.000Z', user: signedInUser },
    errors: [
      {
        status: 401,
        message: 'invalid email or password',
        when: 'Wrong email or password, a locked account, or a deactivated user (all answer the same).',
      },
    ],
  },
  'POST /auth/forgot-password': {
    auth: 'public',
    story: 'Sign Up, Sign In, Forgot Password',
    guide:
      'Emails a single-use link to set a new password. Always answers `202 { ok: true }`, whether or not the email has an account, so it cannot be used to find accounts.',
    request: { email: 'dana@acmecoffee.com' },
    response: { ok: true },
    errors: [{ status: 400, message: 'validation failed', when: 'Not an email address.' }],
  },
  'POST /auth/set-password/token': {
    auth: 'public',
    story: 'Sign Up, Sign In, Forgot Password',
    guide:
      'Sets a new password with the token from the emailed link and signs the user in. The link works once; the old password stops working.',
    request: {
      token: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
      newPassword: 'a brand new long password',
    },
    response: { token: SESSION, expiresAt: '2026-11-04T02:00:00.000Z', user: signedInUser },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'New password shorter than 12 characters.',
      },
      {
        status: 401,
        message: 'this link is no longer valid',
        when: 'The link was used, expired or replaced.',
      },
    ],
  },
  'GET /merchant/onboarding': {
    auth: 'accounts',
    story: 'Sign Up, Sign In, Forgot Password',
    guide:
      'Where onboarding stands, worked out from the data: `REGISTER_COMPANY` → `ADD_BRAND` → `SELECT_PRODUCTS`. Send the user to that step after signing in.',
    response: {
      nextStep: 'ADD_BRAND',
      onboardingComplete: false,
      company: {
        companyName: 'Acme Coffee Group',
        legalName: 'Acme Coffee Group LLC',
        taxId: '12-3456789',
        contactEmail: 'dana@acmecoffee.com',
        brandStructure: 'MULTI',
        registeredAt: '2026-11-03T01:30:00.000Z',
      },
      hasBrands: false,
    },
    errors: [ACCOUNTS_401],
  },
  'POST /merchant/register-company': {
    auth: 'accounts',
    story: 'Register Your Company',
    guide: `Company Admin only. Company Name (unique across all Companies, ignoring case and spacing), Legal Name, Tax ID and Brand Structure (\`SINGLE\` or \`MULTI\`), all required. Done once. The Company's contact email is the sign-up email.

The Brand Structure does not limit how many Brands the Company can have later.`,
    request: {
      companyName: 'Acme Coffee Group',
      legalName: 'Acme Coffee Group LLC',
      taxId: '12-3456789',
      brandStructure: 'MULTI',
    },
    response: { nextStep: 'ADD_BRAND' },
    errors: [
      { status: 400, message: 'validation failed', when: 'A field missing or invalid.' },
      ACCOUNTS_401,
      ADMIN_ONLY,
      {
        status: 409,
        code: 'COMPANY_NAME_TAKEN',
        message: 'a company with this name is already registered',
        when: 'Another Company has this name.',
      },
      {
        status: 409,
        code: 'COMPANY_ALREADY_REGISTERED',
        message: 'this company is already registered',
        when: 'Register Your Company was already done.',
      },
    ],
  },
  'POST /merchant/first-brand': {
    auth: 'accounts',
    story: 'Add Your Brand',
    guide:
      'Company Admin only. The first Brand: Legal Name, Display Name, Currency (e.g. `USD`) and an IANA Timezone (e.g. `America/New_York`) required; Theme Color optional. Later Brands are added from HQ with `POST /company/brands`.',
    request: {
      legalName: 'Acme Coffee LLC',
      displayName: 'Acme Coffee',
      currency: 'USD',
      timezone: 'America/New_York',
      themeColor: '#2D6A6A',
    },
    response: { brand: { id: BRAND_ID, displayName: 'Acme Coffee' }, nextStep: 'SELECT_PRODUCTS' },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'A required field missing, or an invalid currency, timezone or colour.',
      },
      ACCOUNTS_401,
      ADMIN_ONLY,
      {
        status: 409,
        code: 'COMPANY_NOT_REGISTERED',
        message: 'register the company before adding a brand',
        when: 'Register Your Company is not done yet.',
      },
      {
        status: 409,
        code: 'BRAND_ALREADY_ADDED',
        message: 'this company already has a brand; add more from Brand Management',
        when: 'The Company already has a Brand.',
      },
    ],
  },
  'GET /company/products': {
    auth: 'accounts',
    story: 'Select Your Products & Redirect',
    guide:
      'The products (Sugrpay and HQ): whether each is enabled, and whether this user may enable it.',
    response: { products: productCards, onboardingComplete: true },
    errors: [ACCOUNTS_401],
  },
  'POST /company/products': {
    auth: 'accounts',
    story: 'Select Your Products & Redirect',
    guide: `Company Admin only. Enables the products sent (at least one; others untouched) and completes onboarding. The Company Admin gets HQ's top role, \`EXECUTIVE\`.

\`continueWith\` names the product to open straight away when exactly one is enabled; then call Continue for it.`,
    request: { products: ['HQ'] },
    response: { products: productCards, onboardingComplete: true, continueWith: 'HQ' },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'An empty or repeated list, or an unknown product.',
      },
      ACCOUNTS_401,
      ADMIN_ONLY,
      {
        status: 409,
        code: 'COMPANY_NOT_REGISTERED',
        message: 'register the company before enabling products',
        when: 'Register Your Company is not done.',
      },
      {
        status: 409,
        code: 'ADD_BRAND_FIRST',
        message: 'add a brand before enabling products',
        when: 'The Company has no Brand yet.',
      },
    ],
  },
  'POST /company/products/:product/continue': {
    auth: 'accounts',
    story: 'Select Your Products & Redirect',
    guide: `Any user of the Company. For \`HQ\`, returns HQ's web address, the **HQ JWT** (12 hours) and a **refresh token** (30 days).

The Accounts app sends the browser to \`url#token=<JWT>&refreshToken=<refresh token>\`. HQ reads both from the URL fragment (it never reaches a server log), keeps them in local storage, removes the fragment from the address bar, and sends the JWT as \`Authorization: Bearer <JWT>\` on every call.

**Until HQ has a web address** (\`HQ_PUBLIC_URL\` on the server), this answers \`409 PRODUCT_NOT_AVAILABLE\` for HQ.`,
    response: {
      product: 'HQ',
      url: 'https://hq.sugrpay.com',
      token: JWT,
      expiresAt: '2026-11-03T14:00:00.000Z',
      refreshToken: REFRESH,
      refreshExpiresAt: '2026-12-03T02:00:00.000Z',
    },
    errors: [
      { status: 400, message: 'validation failed', when: '`product` is not `HQ` or `INVOICING`.' },
      ACCOUNTS_401,
      {
        status: 409,
        code: 'PRODUCT_NOT_ENABLED',
        message: 'HQ is not enabled for this company',
        when: 'The Company has not enabled HQ. No token is issued.',
      },
      {
        status: 409,
        code: 'PRODUCT_NOT_AVAILABLE',
        message: "HQ isn't available yet",
        when: 'HQ has no web address configured yet.',
      },
    ],
  },

  // --- 2. Product Session -----------------------------------------------
  'GET /product-session/me': {
    auth: 'jwt',
    story: 'Product Session — User Details & Tokens',
    guide: `Who is signed in, from the JWT alone: no user or Company ID is sent. Call it when HQ opens, then call Company Profile with \`companyId\`.

- \`role\` is \`COMPANY_ADMIN\` for the Company Admin; for anyone else it is their **HQ** role (\`EXECUTIVE\`, \`MANAGER\` or \`ASSOCIATE\`) only, never their Sugrpay role.
- Read fresh on every call: a role changed by the Company Admin shows at once.
- \`expiresAt\` is when this JWT expires: refresh shortly before it.
- Company details and Brands are not here (Company Profile has them).`,
    response: {
      user: { id: USER_ID, name: 'Dana Smith', email: 'dana@acmecoffee.com' },
      companyId: COMPANY_ID,
      product: 'HQ',
      role: 'COMPANY_ADMIN',
      expiresAt: '2026-11-03T14:00:00.000Z',
    },
    errors: [
      ...JWT_ERRORS,
      {
        status: 403,
        code: 'NO_PRODUCT_ACCESS',
        message: 'you have no access to this product',
        when: 'The user holds no HQ role (and is not the Company Admin).',
      },
    ],
  },
  'POST /product-session/refresh': {
    auth: 'public',
    story: 'Product Session — User Details & Tokens',
    guide: `Exchanges the refresh token for a **new 12-hour JWT**, without the user signing in again. No Authorization header: the refresh token is the credential. The refresh token itself does not change.

**Suggested HQ logic:** refresh a minute before \`expiresAt\`, or when any call answers \`401\`; retry the call once with the new JWT. If refresh answers \`401 SIGN_IN_REQUIRED\` (the refresh token has expired after 30 days) or \`401 INVALID_REFRESH_TOKEN\`, clear local storage and send the user to Accounts to sign in.`,
    request: { refreshToken: REFRESH },
    response: { token: JWT, expiresAt: '2026-11-04T02:00:00.000Z' },
    errors: [
      { status: 400, message: 'validation failed', when: '`refreshToken` missing.' },
      {
        status: 401,
        code: 'SIGN_IN_REQUIRED',
        message: 'the session has ended; sign in again',
        when: 'The refresh token has expired.',
      },
      {
        status: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'refresh token is not valid',
        when: 'Unknown or revoked token, the user deactivated, or HQ no longer enabled.',
      },
    ],
  },

  // --- 3. Company Profile -----------------------------------------------
  'GET /companies/:companyId': {
    auth: 'jwt',
    story: 'Company Profile — Company Details & Brands',
    guide: `Send the \`companyId\` from \`GET /product-session/me\`. Any signed-in user.

- \`company\`: details; \`contactEmail\` is the company email used at sign-up.
- \`brands\`: the Brands this user can access — **all** of them for the Company Admin, otherwise only those **assigned** to the user (possibly none). Archived Brands are included with \`archived: true\`. \`themeColor\` is \`null\` when none was set.
- Use the Brand IDs in further calls. No role and no Locations here. Ask again whenever fresh data is needed.`,
    response: {
      company,
      brands: [
        brand,
        {
          ...brand,
          id: BRAND_ID_2,
          legalName: 'Acme Roasters LLC',
          displayName: 'Acme Roasters',
          themeColor: null,
          status: 'ARCHIVED',
          archived: true,
        },
      ],
    },
    errors: [
      { status: 400, message: 'validation failed', when: '`companyId` is not a UUID.' },
      ...JWT_ERRORS,
      {
        status: 403,
        code: 'NOT_YOUR_COMPANY',
        message: 'that is not your Company',
        when: "The ID is not the signed-in Company's. Nothing is returned.",
      },
    ],
  },

  // --- 4. Brand Management ----------------------------------------------
  'POST /company/brands': {
    auth: 'jwt',
    story: 'Brand Management',
    guide: `Company Admin only. Adds an **active** Brand to the signed-in Company.

- Required: Legal Name, Display Name, Currency (ISO code, e.g. \`USD\`), Timezone (IANA, e.g. \`America/Chicago\`). Optional: Theme Color (\`#RRGGBB\`).
- Display Name must be unique within the Company, ignoring case and extra spaces; another Company may use the same name.
- There is no limit on the number of Brands, whatever Brand Structure was chosen.
- Returns the new Brand's ID: use it in further calls.`,
    request: {
      legalName: 'Acme Roasters LLC',
      displayName: 'Acme Roasters',
      currency: 'USD',
      timezone: 'America/Chicago',
      themeColor: '#7A4B2A',
    },
    response: { id: BRAND_ID_2, displayName: 'Acme Roasters', status: 'ACTIVE' },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'A required detail missing, or an invalid currency, timezone or colour (each listed under `issues`).',
      },
      ...JWT_ERRORS,
      ADMIN_ONLY,
      {
        status: 409,
        code: 'DISPLAY_NAME_TAKEN',
        message: 'another Brand in your Company already has this Display Name',
        when: 'The Display Name is used by another Brand of the Company.',
      },
    ],
  },
  'PUT /company/brands/:brandId': {
    auth: 'jwt',
    story: 'Brand Management',
    guide:
      "Company Admin only. Replaces the Brand's details under the same rules as adding (send all four required details; leave out `themeColor` to clear it). Keeping the Brand's own Display Name is fine. Returns the updated Brand.",
    request: {
      legalName: 'Acme Roasters Holdings LLC',
      displayName: 'Acme Roasters',
      currency: 'USD',
      timezone: 'America/Chicago',
      themeColor: '#7A4B2A',
    },
    response: {
      ...brand,
      id: BRAND_ID_2,
      legalName: 'Acme Roasters Holdings LLC',
      displayName: 'Acme Roasters',
      timezone: 'America/Chicago',
      themeColor: '#7A4B2A',
    },
    errors: [
      { status: 400, message: 'validation failed', when: 'A required detail removed or invalid.' },
      ...JWT_ERRORS,
      {
        status: 403,
        message: 'insufficient permissions',
        when: 'The Brand belongs to another Company (nothing changes), or the user may not manage Brands.',
      },
      ADMIN_ONLY,
      {
        status: 409,
        code: 'DISPLAY_NAME_TAKEN',
        message: 'another Brand in your Company already has this Display Name',
        when: "Renamed to another Brand's Display Name.",
      },
    ],
  },
  'POST /company/brands/:brandId/archive': {
    auth: 'jwt',
    story: 'Brand Management',
    guide:
      'Company Admin only. Marks the Brand archived and returns it. Archiving an archived Brand changes nothing. Archived Brands still appear in Company Profile, marked `archived: true`.',
    response: { ...brand, status: 'ARCHIVED', archived: true },
    errors: [
      ...JWT_ERRORS,
      {
        status: 403,
        message: 'insufficient permissions',
        when: 'The Brand belongs to another Company (nothing changes), or the user may not manage Brands.',
      },
      ADMIN_ONLY,
    ],
  },

  // --- 5. User Management -----------------------------------------------
  'GET /company/users': {
    auth: 'jwt',
    story: 'User Management — User List',
    guide: `Company Admin only. The Company's users, including deactivated ones (\`status: DEACTIVATED\`). No Company ID is sent.

- \`role\` is each user's **HQ** role only (\`COMPANY_ADMIN\` for the Company Admin; \`null\` for a user with no HQ role).
- \`brandId\` (optional) narrows to the users assigned to that Brand. The Company Admin appears under every Brand; a user with several Brands appears under each. A Brand with nobody else assigned returns just the Company Admin.
- \`phone\` is \`null\` for accounts created before phones were recorded.`,
    response: [
      {
        id: USER_ID,
        name: 'Dana Smith',
        email: 'dana@acmecoffee.com',
        phone: null,
        role: 'COMPANY_ADMIN',
        brands: [
          { id: BRAND_ID, displayName: 'Acme Coffee', archived: false },
          { id: BRAND_ID_2, displayName: 'Acme Roasters', archived: false },
        ],
        status: 'ACTIVE',
      },
      member,
    ],
    errors: [
      { status: 400, message: 'validation failed', when: '`brandId` is not a UUID.' },
      ...JWT_ERRORS,
      ADMIN_ONLY,
      {
        status: 404,
        message: 'brand not found',
        when: "`brandId` is another Company's Brand. No users are returned.",
      },
    ],
  },
  'POST /company/users': {
    auth: 'jwt',
    story: 'User Management — Users, Roles & Access',
    guide: `Company Admin only. Adds an **active** user to the signed-in Company. They sign in with this email and password.

- All required: \`name\`, \`email\` (unique across the platform), \`phone\` (\`country\`: 2-letter code, \`number\`: valid for that country), \`password\` (at least 12 characters), \`role\` (an \`id\` from \`GET /company/roles\`) and \`brandIds\` (at least one Brand of the Company).
- The Company Admin is not assigned Brands: they have all of them.
- Returns the user with their HQ role, Brands and status.`,
    request: {
      name: 'Riley Stone',
      email: 'riley@acmecoffee.com',
      phone: { country: 'US', number: '(202) 555-0143' },
      password: 'a long enough password',
      role: 'MANAGER',
      brandIds: [BRAND_ID],
    },
    response: member,
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'A detail missing, an invalid email, a short password, a bad country code, or no Brand (each listed under `issues`).',
      },
      {
        status: 400,
        code: 'PHONE_INVALID',
        message: 'enter a valid phone number for that country',
        when: 'The number is not valid for the country.',
      },
      {
        status: 400,
        code: 'ROLE_NOT_AVAILABLE',
        message: 'choose one of the roles for this product',
        when: "The role is not one of HQ's roles.",
      },
      {
        status: 400,
        code: 'BRAND_NOT_IN_COMPANY',
        message: 'choose Brands of your Company',
        when: 'A Brand belongs to another Company.',
      },
      ...JWT_ERRORS,
      ADMIN_ONLY,
      {
        status: 409,
        code: 'EMAIL_TAKEN',
        message: 'an account with this email already exists',
        when: 'Any account on the platform uses this email.',
      },
    ],
  },
  'PUT /company/users/:userId': {
    auth: 'jwt',
    story: 'User Management — Users, Roles & Access',
    guide: `Company Admin only. Replaces the user's name, email, phone, HQ role and Brands, under the same rules as adding. The password is not part of editing.

The change shows at once in \`GET /product-session/me\` and Company Profile for that user. Their Sugrpay role (if any) is untouched.`,
    request: {
      name: 'Riley Stone',
      email: 'riley.stone@acmecoffee.com',
      phone: { country: 'US', number: '(202) 555-0143' },
      role: 'EXECUTIVE',
      brandIds: [BRAND_ID, BRAND_ID_2],
    },
    response: {
      ...member,
      email: 'riley.stone@acmecoffee.com',
      role: 'EXECUTIVE',
      brands: [
        { id: BRAND_ID, displayName: 'Acme Coffee', archived: false },
        { id: BRAND_ID_2, displayName: 'Acme Roasters', archived: false },
      ],
    },
    errors: [
      {
        status: 400,
        message: 'validation failed',
        when: 'A detail removed or invalid, or all Brands removed.',
      },
      {
        status: 400,
        code: 'PHONE_INVALID',
        message: 'enter a valid phone number for that country',
        when: 'The number is not valid for the country.',
      },
      {
        status: 400,
        code: 'ROLE_NOT_AVAILABLE',
        message: 'choose one of the roles for this product',
        when: "The role is not one of HQ's roles.",
      },
      {
        status: 400,
        code: 'BRAND_NOT_IN_COMPANY',
        message: 'choose Brands of your Company',
        when: 'A Brand belongs to another Company.',
      },
      ...JWT_ERRORS,
      ADMIN_ONLY,
      {
        status: 404,
        message: 'user not found',
        when: 'The user belongs to another Company. Nothing changes.',
      },
      {
        status: 409,
        code: 'EMAIL_TAKEN',
        message: 'an account with this email already exists',
        when: 'Another account uses the new email.',
      },
      {
        status: 409,
        code: 'COMPANY_ADMIN_ACCOUNT',
        message: "the Company Admin's account is not managed here",
        when: 'The user is the Company Admin.',
      },
    ],
  },
  'POST /company/users/:userId/deactivate': {
    auth: 'jwt',
    story: 'User Management — Users, Roles & Access',
    guide:
      'Company Admin only. The user can no longer sign in, and their sessions end at once (their HQ JWT and refresh token stop working). Their records are kept, and they still appear in the User List as `DEACTIVATED`. The Company Admin cannot deactivate their own account.',
    response: { ...member, status: 'DEACTIVATED' },
    errors: [
      ...JWT_ERRORS,
      ADMIN_ONLY,
      {
        status: 403,
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'you cannot deactivate your own account',
        when: 'The Company Admin named their own account.',
      },
      {
        status: 404,
        message: 'user not found',
        when: 'The user belongs to another Company. Nothing changes.',
      },
      {
        status: 409,
        code: 'COMPANY_ADMIN_ACCOUNT',
        message: "the Company Admin's account is not managed here",
        when: 'The user is the Company Admin.',
      },
    ],
  },
  'POST /company/users/:userId/reactivate': {
    auth: 'jwt',
    story: 'User Management — Users, Roles & Access',
    guide:
      'Company Admin only. A deactivated user becomes active again and can sign in again. Reactivating an active user changes nothing.',
    response: member,
    errors: [
      ...JWT_ERRORS,
      ADMIN_ONLY,
      { status: 404, message: 'user not found', when: 'The user belongs to another Company.' },
      {
        status: 409,
        code: 'COMPANY_ADMIN_ACCOUNT',
        message: "the Company Admin's account is not managed here",
        when: 'The user is the Company Admin.',
      },
    ],
  },

  // --- 6. Role List -----------------------------------------------------
  'GET /company/roles': {
    auth: 'jwt',
    story: 'Role Management — Role List',
    guide:
      "Company Admin only. HQ's fixed roles, the same for every Company, each with the `id` User Management takes as `role` and a display `name`. The Company Admin is not in the list: that is the account's own company-level access. Companies cannot create, edit or delete roles.",
    response: [
      { id: 'EXECUTIVE', name: 'Executive' },
      { id: 'MANAGER', name: 'Manager' },
      { id: 'ASSOCIATE', name: 'Associate' },
    ],
    errors: [...JWT_ERRORS, ADMIN_ONLY],
  },

  // --- 7. Service -------------------------------------------------------
  'GET /health': {
    auth: 'public',
    story: null,
    guide:
      'Whether the API and what it depends on (database, Redis, storage) are up. `200` when every check is up, `503` otherwise. No sign-in.',
    response: {
      status: 'ok',
      checks: [
        { name: 'database', state: 'up', durationMs: 3 },
        { name: 'redis', state: 'up', durationMs: 1 },
      ],
    },
    errors: [],
  },
};
