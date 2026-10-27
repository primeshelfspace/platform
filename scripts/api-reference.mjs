#!/usr/bin/env node
/**
 * Generates docs/api/endpoints.md from the controllers of every API (platform,
 * Sugrpay, HQ, plus the shared ones in packages/server), so the endpoint
 * list cannot drift from the code: every route's method, path, access rule,
 * request schema and response type is read from the source. Descriptions are
 * the one place a human writes, in DESCRIPTIONS below; a route without one
 * fails the run, so a new endpoint cannot ship undocumented.
 *
 *   node scripts/api-reference.mjs           # rewrite docs/api/endpoints.md
 *   node scripts/api-reference.mjs --check   # fail if it is out of date
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/env.mjs';

/** Where controllers live, and which API serves them. */
const SOURCES = [
  { dir: path.join(ROOT, 'apps/platform/src'), api: 'platform' },
  { dir: path.join(ROOT, 'apps/sugrpay/src'), api: 'sugrpay' },
  { dir: path.join(ROOT, 'apps/hq/src'), api: 'hq' },
  // Health and local file serving exist on every API.
  { dir: path.join(ROOT, 'packages/server/src'), api: 'every API' },
];
const OUT = path.join(ROOT, 'docs/api/endpoints.md');

/** One line per route, keyed "METHOD /path". */
const DESCRIPTIONS = {
  'POST /public/webhooks/mail':
    'Mail delivery events (delivered, bounced, spam complaint) for invoice emails, signed with MAIL_WEBHOOK_SECRET. A bounce or complaint is added to the invoice timeline. See docs/integrations/mail-delivery.md.',
  'POST /internal/sessions/resolve':
    "Platform: who a session token belongs to (the caller's scope, or null). What a product API's request guard asks on every signed-in request.",
  'GET /internal/brands/:brandId/stripe-account':
    "Platform: the brand's connected Stripe account id, for taking a card payment.",
  'GET /internal/stripe-accounts/:accountId/brand':
    'Platform: which brand a Stripe connected account belongs to, for routing a Stripe webhook.',
  'POST /internal/brands/:brandId/theme-color':
    "Platform: sets a brand's colour (Sugrpay's branding screens edit it; the brand is the platform's).",
  'POST /internal/audit': "Platform: writes an entry to the platform's append-only audit log.",
  'POST /internal/events':
    'Sugrpay: receives a platform event (brand created/updated, …) from the platform outbox; a failure makes the platform retry.',
  // Sign-in
  'POST /auth/register':
    'Self-serve sign-up: creates the company, its owner (invited) and the Sugrpay subscription, and emails a set-password link. Signing up again before the password is set re-sends the link; 409 once sign-up is finished; 503 (and nothing kept) if the email cannot be sent.',
  'POST /auth/login':
    'Signs in with email and password. Returns the session token (also set as a cookie) and its expiry. Locks the account after 5 failures in 15 minutes.',
  'POST /auth/logout': 'Ends the current session.',
  'GET /auth/me':
    'The signed-in user: role, company, brands, products, product roles, locations and permissions.',
  'POST /auth/set-password': 'Signed-in user replaces a temporary password.',
  'POST /auth/set-password/token':
    'Sets a password from an emailed link (sign-up, invitation or reset) and signs the user in.',
  'POST /auth/forgot-password':
    'Emails a password-reset link. Always answers the same way, so it does not reveal which emails exist.',
  // Company
  'GET /merchant/onboarding':
    'Onboarding state: company details, brand structure, whether brands exist and whether onboarding is complete.',
  'PATCH /merchant/company-details': 'Saves the company details step of onboarding.',
  'POST /merchant/logo': 'Uploads the company logo (multipart field `file`, up to 5 MB).',
  'POST /merchant/brand-structure': 'Chooses single-brand or multi-brand.',
  'POST /merchant/complete-onboarding': 'Marks onboarding complete.',
  'GET /company/subscriptions': "The company's products and whether each is switched on.",
  'PUT /company/subscriptions/:product':
    'Switches a product on or off for the company (no billing provider yet).',
  // Brands
  'GET /brands': 'Brands the user can reach (all of them for Owner and Admin).',
  'POST /brands': 'Creates a brand with its invoice numbering prefix.',
  'PATCH /brands/:brandId':
    "Updates a brand's details (names, contact, addresses, currency, timezone, colour).",
  'POST /brands/:brandId/logo': 'Uploads the brand logo (multipart field `file`, up to 5 MB).',
  // Users and locations
  'GET /users': 'Team list, paginated.',
  'GET /users/:id': 'One team member with brands, product roles and locations.',
  'POST /users/invite': 'Invites a person with a role and brands; emails them a set-password link.',
  'PATCH /users/:id/role': "Changes a person's account role.",
  'PUT /users/:id/brands': 'Replaces the brands a person is assigned to.',
  'PUT /users/:id/locations': 'Replaces the locations a person is assigned to.',
  'PUT /users/:id/product-roles/:product': "Sets or removes a person's role in one product.",
  'PATCH /users/:id/status':
    'Suspends or reactivates a person (suspending signs them out everywhere).',
  'GET /locations': 'Stores and warehouses the user can see.',
  'POST /locations': 'Creates a store or warehouse, optionally tied to a brand.',
  'GET /locations/:id': 'One location.',
  'PATCH /locations/:id': 'Renames, moves, archives or restores a location.',
  // Customers
  'GET /brands/:brandId/customers':
    'Customers of a brand: search, status and balance filters, paginated.',
  'POST /brands/:brandId/customers': 'Creates a customer (business or individual).',
  'GET /brands/:brandId/customers/:id': 'One customer with contact persons and balance.',
  'PATCH /brands/:brandId/customers/:id': 'Updates a customer.',
  // Invoices
  'GET /brands/:brandId/invoices':
    'Invoices of a brand: status tabs, search, date range, paginated.',
  'POST /brands/:brandId/invoices':
    'Creates a draft invoice; totals, tax and card fee are calculated by the server.',
  'GET /brands/:brandId/invoices/summary': 'Outstanding amount and count of open invoices.',
  'GET /brands/:brandId/invoices/tab-counts':
    'Counts for the All / Draft / Unpaid / Partial / Paid / Overdue tabs.',
  'GET /brands/:brandId/invoices/:id': 'One invoice with its lines and public payment token.',
  'GET /brands/:brandId/invoices/:id/events':
    "The invoice's history: issued, viewed, paid, cancelled and so on.",
  'GET /brands/:brandId/invoices/:id/email-preview':
    'Pre-filled recipient, subject and body for sending this invoice.',
  'POST /brands/:brandId/invoices/:id/issue':
    'Issues a draft: it gets its final number, becomes SENT and its payment link goes live.',
  'POST /brands/:brandId/invoices/:id/send-email':
    'Emails the invoice (optionally with the PDF attached) to the customer.',
  'POST /brands/:brandId/invoices/bulk-send': 'Emails several invoices at once.',
  'POST /brands/:brandId/invoices/:id/payments':
    'Records money received outside the platform (manual, check or ACH), full or partial.',
  'POST /brands/:brandId/invoices/:id/cancel':
    'Cancels an invoice and deactivates its payment link.',
  // Payments and checks
  'GET /brands/:brandId/payments':
    'Payments received for a brand, paginated, with search and status filters.',
  'GET /brands/:brandId/checks': 'Checks customers have uploaded, by review status.',
  'GET /brands/:brandId/checks/:id': 'One uploaded check with signed image links.',
  'POST /brands/:brandId/checks/:id/approve':
    'Approves a check: records the payment against the invoice.',
  'POST /brands/:brandId/checks/:id/reject': 'Rejects a check with a reason.',
  // Brand settings
  'PUT /brands/:brandId/settings/invoice-numbering':
    'Sets the invoice number prefix and next number.',
  'GET /brands/:brandId/settings/payment-methods':
    'Which payment methods the brand accepts (card, Apple/Google Pay, ACH, check).',
  'PATCH /brands/:brandId/settings/payment-methods': 'Turns payment methods on or off.',
  'GET /brands/:brandId/settings/payment-page-display': 'Payment page colours and layout.',
  'PATCH /brands/:brandId/settings/payment-page-display':
    'Changes payment page colours and layout.',
  'GET /brands/:brandId/settings/email-receipt':
    'Invoice, payment-confirmation and payment-failed email templates.',
  'PATCH /brands/:brandId/settings/email-receipt': 'Changes the email templates.',
  'POST /brands/:brandId/settings/email-receipt/test-send':
    'Sends a test email using unsaved template values.',
  'GET /brands/:brandId/settings/invoice-pdf': 'Invoice PDF layout and options.',
  'PATCH /brands/:brandId/settings/invoice-pdf': 'Changes the invoice PDF layout and options.',
  // Dashboard
  'GET /dashboard/summary':
    'Invoiced, collected, collection rate and overdue for a brand (or all brands).',
  'GET /dashboard/trend': 'Invoiced vs collected per month.',
  'GET /dashboard/status-breakdown': 'Totals by invoice status.',
  'GET /dashboard/top-overdue-customers': 'Customers with the largest overdue balances.',
  'GET /dashboard/needs-attention':
    'Items needing action: overdue invoices, failed syncs, checks to review.',
  'GET /dashboard/recent-activity': 'Latest invoice and payment events.',
  'GET /dashboard/by-brand': 'Headline figures for every brand the user can reach.',
  'GET /dashboard/cross-brand-customers': 'Customers who buy from more than one brand.',
  'GET /dashboard/integrations-status':
    "Whether the brand's accounting integration is connected and when it last synced.",
  'POST /dashboard/sync-jobs/:jobId/retry': 'Retries a failed sync job.',
  // Payment gateways
  'GET /brands/:brandId/integrations/gateways':
    'Every payment gateway and whether the brand has connected it.',
  'POST /brands/:brandId/integrations/gateways/:provider/connect':
    "Records the brand's choice of a gateway that has no OAuth flow (e.g. PayPal).",
  'POST /brands/:brandId/integrations/gateways/:provider/disconnect': 'Removes that choice.',
  'GET /brands/:brandId/integrations/stripe/status':
    'Whether the brand has connected Stripe, and the account.',
  'GET /brands/:brandId/integrations/stripe/connect':
    'Starts Stripe Connect: returns the Stripe authorisation URL (400 if Stripe is not configured).',
  'POST /brands/:brandId/integrations/stripe/disconnect': "Disconnects the brand's Stripe account.",
  'GET /integrations/stripe/callback':
    'Stripe sends the brand back here after authorising; finishes the connection.',
  'GET /brands/:brandId/integrations/square/status': 'Whether the brand has connected Square.',
  'GET /brands/:brandId/integrations/square/connect':
    'Starts Square OAuth (400 if Square is not configured).',
  'POST /brands/:brandId/integrations/square/disconnect': 'Disconnects Square.',
  'GET /integrations/square/callback': 'Square sends the brand back here after authorising.',
  'GET /brands/:brandId/integrations/authorize-net/status':
    'Whether the brand has connected Authorize.net.',
  'POST /brands/:brandId/integrations/authorize-net/connect':
    "Saves and verifies the brand's Authorize.net API Login ID and Transaction Key (stored encrypted).",
  'POST /brands/:brandId/integrations/authorize-net/disconnect':
    'Removes the Authorize.net credentials.',
  // Zoho Books
  'GET /brands/:brandId/integrations/zoho/status':
    'Zoho Books connection state, organisation and last sync times.',
  'GET /brands/:brandId/integrations/zoho/connect': 'Starts Zoho OAuth: redirects to Zoho.',
  'GET /integrations/zoho/callback': 'Zoho sends the brand back here after authorising.',
  'POST /brands/:brandId/integrations/zoho/disconnect': 'Disconnects Zoho Books.',
  'PATCH /brands/:brandId/integrations/zoho/settings':
    'Sync settings: what to sync and how often to pull.',
  'GET /brands/:brandId/integrations/zoho/activity':
    'Sync log: what was pushed and pulled, and failures.',
  'POST /brands/:brandId/integrations/zoho/backfill':
    'Pushes existing customers and invoices to Zoho.',
  'POST /brands/:brandId/integrations/zoho/pull': 'Pulls changes from Zoho now ("Sync now").',
  'GET /brands/:brandId/integrations/zoho/webhook-setup':
    'The webhook URLs to paste into Zoho for real-time sync.',
  'GET /brands/:brandId/integrations/zoho/sandboxes':
    'Zoho sandbox copies for testing changes before production.',
  'POST /brands/:brandId/integrations/zoho/sandboxes': 'Creates a sandbox.',
  'GET /brands/:brandId/integrations/zoho/sandboxes/:sandboxId': 'One sandbox.',
  'PATCH /brands/:brandId/integrations/zoho/sandboxes/:sandboxId':
    'Renames or reconfigures a sandbox.',
  'DELETE /brands/:brandId/integrations/zoho/sandboxes/:sandboxId': 'Deletes a sandbox.',
  'PATCH /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/activation':
    'Makes a sandbox the active sync target, or switches back.',
  'POST /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/rebuild':
    'Rebuilds a sandbox from production data.',
  'GET /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/changes':
    'Changes made in a sandbox, waiting to be pushed.',
  'PATCH /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/changes/:changeId':
    'Includes or excludes one change from the next push.',
  'POST /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/push/validate':
    'Dry run of pushing sandbox changes to production.',
  'POST /brands/:brandId/integrations/zoho/sandboxes/:sandboxId/push':
    'Pushes sandbox changes to production Zoho.',
  'GET /brands/:brandId/integrations/zoho/sandboxes/logs/deployments': 'History of sandbox pushes.',
  'POST /webhooks/zoho/contacts':
    'Zoho calls this when a contact changes (authenticated by a per-organisation token in the URL).',
  'POST /webhooks/zoho/invoices': 'Zoho calls this when an invoice changes (same token).',
  'GET /webhooks/zoho/pending-assignments':
    'Records from Zoho waiting for someone to choose which brand they belong to.',
  'POST /webhooks/zoho/pending-assignments/:id/assign': 'Assigns a pending Zoho record to a brand.',
  // Public payment pages
  'GET /public/invoices/:token':
    "The customer's view of an invoice by its payment-link token: amounts, lines, brand look, accepted methods. Records the first view.",
  'GET /public/invoices/:token/pdf': 'The invoice as a PDF.',
  'POST /public/invoices/:token/payment-intents':
    'Starts a payment for the invoice (card, wallet or ACH) with the configured gateway.',
  'POST /public/invoices/:token/payment-intents/reconcile':
    'After the browser confirms a card payment, asks the gateway for the real outcome (fallback when the webhook has not arrived).',
  'POST /public/invoices/:token/checks':
    'The customer uploads a check: number, amount, front and back images (multipart, up to 10 MB each).',
  'POST /public/webhooks/stripe':
    'Stripe payment events (signature verified with STRIPE_WEBHOOK_SECRET).',
  'POST /public/webhooks/fake-gateway':
    'Payment events from the built-in test gateway (signature verified; local testing only).',
  'GET /storage/local':
    'Serves an uploaded file by signed, expiring link when files are stored on local disk (not used with S3).',
  // Health
  'GET /health': "Overall status, environment, active adapters and each dependency's state.",
  'GET /health/live': 'Liveness: the process is running.',
  'GET /health/ready': 'Readiness: databases, Redis and storage reachable.',
  'GET /health/queues': 'Job queue sizes and states.',
};

const AREAS = [
  ['Internal (API to API)', (p) => p.startsWith('/internal')],
  ['Sign-in', (p) => p.startsWith('/auth')],
  ['Company and onboarding', (p) => p.startsWith('/merchant') || p.startsWith('/company')],
  ['Brands', (p) => /^\/brands(\/:brandId)?(\/logo)?$/.test(p)],
  ['Team', (p) => p.startsWith('/users')],
  ['Locations', (p) => p.startsWith('/locations')],
  ['Customers', (p) => p.includes('/customers')],
  [
    'Invoices',
    (p) => p.includes('/invoices') && !p.startsWith('/public') && !p.startsWith('/webhooks'),
  ],
  ['Payments and checks', (p) => /\/brands\/:brandId\/(payments|checks)/.test(p)],
  ['Brand settings', (p) => p.includes('/settings/')],
  ['Dashboard', (p) => p.startsWith('/dashboard')],
  ['Payment gateways', (p) => /\/(stripe|square|authorize-net|gateways)/.test(p)],
  ['Zoho Books', (p) => p.includes('zoho')],
  ['Public payment pages and webhooks', (p) => p.startsWith('/public') || p.startsWith('/storage')],
  ['Health', (p) => p.startsWith('/health')],
];

function controllers() {
  const files = [];
  for (const { dir, api } of SOURCES) {
    if (!fs.existsSync(dir)) continue;
    (function walk(d) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.controller.ts') || f.endsWith('.module.ts'))
          files.push({ file: p, api });
      }
    })(dir);
  }
  return files;
}

function routes() {
  const out = [];
  for (const { file: f, api } of controllers()) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/@Controller\(/.test(s)) continue;
    const base = (s.match(/@Controller\(\s*['"`]([^'"`]*)['"`]/) || [, ''])[1];
    const head = s.slice(
      s.lastIndexOf('\n', s.indexOf('@Controller(')),
      s.indexOf('export class', s.indexOf('@Controller(')),
    );
    const classPublic = /@Public\(\)/.test(head);
    const product = (head.match(/@ProductScope\(\s*['"`](\w+)['"`]/) || [])[1] || null;
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?/);
      if (!m) continue;
      let j = i - 1;
      const above = [];
      while (j >= 0 && /^\s*@/.test(lines[j])) above.unshift(lines[j--]);
      // Decorators can span several lines (@UseInterceptors(...)), so the
      // method is the next line that starts at class-member indentation.
      let k = i + 1;
      const below = [];
      while (k < lines.length && !/^ {2}(async )?[a-z]\w*\(/.test(lines[k])) below.push(lines[k++]);
      // The method signature: from its name to the parenthesis that closes
      // the parameter list, plus the return type up to the body's `{` at the
      // end of that line. Matching parentheses (not looking for `{`) because
      // return types like Promise<{ ok: true }> contain braces themselves.
      let sig = '';
      let ret = '';
      let depth = 0;
      let opened = false;
      scan: for (let n = k; n < lines.length && n < k + 60; n++) {
        const line = lines[n];
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          sig += ch;
          if (ch === '(') {
            depth++;
            opened = true;
          } else if (ch === ')') {
            depth--;
            if (opened && depth === 0) {
              ret = line
                .slice(c + 1)
                .replace(/\{\s*$/, '')
                .replace(/^\s*:\s*/, '')
                .trim();
              break scan;
            }
          }
        }
        sig += '\n';
      }
      const decos = above.concat(below).join('\n');
      const perm = (decos.match(/@RequirePermission\(([^)]*)\)/) || [])[1];
      const internal = /@InternalOnly\(\)/.test(decos);
      const isPublic = !internal && (classPublic || /@Public\(\)/.test(decos));
      const body = (sig.match(/@Body\(\s*zodPipe\((\w+)\)/) || [])[1];
      const query = (sig.match(/@Query\(\s*zodPipe\((\w+)\)/) || [])[1];
      const upload = /FileInterceptor|FileFieldsInterceptor|@UploadedFile/.test(decos + sig);
      ret = ret.replace(/^Promise<([\s\S]*)>$/, '$1');
      const code = (decos.match(/@HttpCode\((\d+)/) || [])[1];
      const p = ('/' + [base, m[2] || ''].filter(Boolean).join('/')).replace(/\/+/g, '/');
      out.push({
        method: m[1].toUpperCase(),
        path: p,
        isPublic,
        perm: perm ? perm.replace(/\s+/g, ' ').trim() : null,
        product,
        body,
        query,
        upload,
        ret: ret.replace(/\s+/g, ' '),
        code,
        file: path.relative(ROOT, f).split(path.sep).join('/'),
        api,
        internal,
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function access(r) {
  if (r.internal) return 'internal key only';
  if (r.isPublic) return 'public';
  const [resource, action] = (r.perm || '').split(',').map((x) => x.trim().replace(/['"]/g, ''));
  const brand = /brandFrom: 'query'/.test(r.perm || '') ? ' (brand from `?brandId`)' : '';
  return `\`${resource}:${action}\`${r.product ? ` · ${r.product}` : ''}${brand}`;
}

function render(all) {
  const missing = all
    .filter((r) => !DESCRIPTIONS[`${r.method} ${r.path}`])
    .map((r) => `${r.method} ${r.path}`);
  if (missing.length) {
    console.error(
      `No description for:\n  ${missing.join('\n  ')}\nAdd them to DESCRIPTIONS in scripts/api-reference.mjs.`,
    );
    process.exit(1);
  }
  const by = {};
  for (const r of all) by[r.method] = (by[r.method] || 0) + 1;
  const lines = [
    '# API endpoints',
    '',
    'Three APIs, each its own program: **platform** (platform-api.sugrpay.com), **sugrpay**',
    '(sugrpay-api.sugrpay.com) and **hq** (hq-api.sugrpay.com, not built yet). The API column says which one',
    'serves each route; api.sugrpay.com also accepts every route and passes it on to the right one. The rule',
    'is `apiServiceFor` in `packages/platform-contracts/src/api-routing.ts`. **Internal** routes answer only the',
    'other APIs (shared INTERNAL_API_KEY; refused from the internet).',
    '',
    '<!-- Generated by scripts/api-reference.mjs from the controllers. Do not edit by hand:',
    '     change the code (or the description in that script) and run `pnpm docs:api`. -->',
    '',
    `${all.length} endpoints (${Object.entries(by)
      .map(([m, n]) => `${n} ${m}`)
      .join(', ')}); ` +
      `${all.filter((r) => r.isPublic).length} public. How to call them — sign-in, errors, pagination, money — is in [README.md](README.md).`,
    '',
    "**Access** is the permission the caller's role must hold (`RESOURCE:ACTION`, see",
    '[products-and-access](../architecture/products-and-access.md)); `INVOICING` means the company must subscribe to',
    'Sugrpay and the user must hold a Sugrpay role. Routes under `/brands/:brandId` also require the brand to be one',
    'the user can reach. **Request** names the schema the body (or query string) is validated against — in',
    '`packages/invoicing-contracts/src/schemas.ts` or `packages/platform-contracts/src/schemas.ts`.',
    '',
  ];
  const used = new Set();
  for (const [area, test] of AREAS) {
    const rs = all.filter((r) => !used.has(r) && test(r.path));
    if (!rs.length) continue;
    rs.forEach((r) => used.add(r));
    lines.push(
      `## ${area}`,
      '',
      '| API | Method | Path | Access | Request | Response | What it does |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of rs) {
      const reqParts = [
        r.body && `body \`${r.body}\``,
        r.query && `query \`${r.query}\``,
        r.upload && 'multipart upload',
      ].filter(Boolean);
      const resp = [
        r.code && `${r.code}`,
        r.ret && r.ret !== 'void'
          ? `\`${r.ret.replace(/\|/g, '\\|')}\``
          : r.ret === 'void'
            ? 'no body'
            : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `| ${r.api} | ${r.method} | \`${r.path}\` | ${access(r)} | ${reqParts.join(', ') || '—'} | ${resp || '—'} | ${DESCRIPTIONS[`${r.method} ${r.path}`].replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('');
  }
  const rest = all.filter((r) => !used.has(r));
  if (rest.length) throw new Error(`routes in no area: ${rest.map((r) => r.path).join(', ')}`);
  return lines.join('\n');
}

// Formatted with the repository's own Prettier settings, so `pnpm format:check`
// and `--check` agree on what the file should look like.
const prettier = await import('prettier');
const md = await prettier.format(render(routes()), {
  ...(await prettier.resolveConfig(OUT)),
  parser: 'markdown',
});
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== md) {
    console.error('docs/api/endpoints.md is out of date: run `pnpm docs:api`.');
    process.exit(1);
  }
  console.log('docs/api/endpoints.md is up to date.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
