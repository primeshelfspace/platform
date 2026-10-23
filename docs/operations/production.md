# Production: what runs where, and how to operate it

The handover guide for the live Sugrpay system. Read this before touching
production. Secrets are never written here — only where they live.

_Last updated: 24 October 2026._

## 1. The system in one picture

```
                         sugrpay.com (DNS at GoDaddy)
                                   │
        ┌──────────────────────────┼───────────────────────────────┐
        │                          │                               │
  www.sugrpay.com            sugrpay.com              api.sugrpay.com, platform-api.,
  CNAME → Amplify            A → 13.56.132.111        sugrpay-api., hq-api.sugrpay.com
        │                    (301 → www)              A → 13.56.132.111
        ▼                          │                               ▼
┌────────────────────┐             │             ┌──────────────────────────────────┐
│ AWS Amplify        │             └────────────►│ EC2 "platform" (us-west-1)       │
│ app d2t9agxhkkuf4e │                           │ Elastic IP 13.56.132.111         │
│ sugrpay-frontend   │── HTTPS (server side) ───►│ nginx :443 → APIs :4001-4003     │
│ one Next.js app:   │                           │ pm2: platform-api, sugrpay-api,  │
│  /  /accounts /pay │                           │      sugrpay-worker, hq-api      │
└────────────────────┘                           │ Redis (local, AOF)               │
                                                 └──┬─────────┬─────────┬───────────┘
                                                    │         │         │
                                RDS "platform"  ◄───┘         │         └──► S3, Gmail SMTP,
                                RDS "invoicing-db" ◄──────────┘              Stripe, Zoho Books
```

| Piece                                        | Where                                                                    | Code                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Web app (Sugrpay admin, `/accounts`, `/pay`) | AWS Amplify, app `d2t9agxhkkuf4e`, us-west-1                             | [sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend) |
| The three APIs + Sugrpay's worker            | EC2 instance `platform` (`i-0b9d7857fb8592487`), t3.small, Ubuntu 26.04  | this repository (`apps/platform`, `apps/sugrpay`, `apps/hq`)            |
| Platform database                            | RDS `platform` (PostgreSQL, db.t4g.micro)                                | `apps/platform/prisma`                                                  |
| Invoicing database                           | RDS `invoicing-db` (PostgreSQL, db.t4g.micro)                            | `apps/sugrpay/prisma`                                                   |
| Job queues                                   | Redis on the EC2 itself (`redis-server`, `noeviction`, append-only file) | `apps/sugrpay/src/infra/queue`                                          |
| Uploaded files (logos, check images)         | S3 bucket `invoice-dev-839810213531-us-east-1-an` (us-east-1)            | storage adapter (`packages/server`)                                     |
| Email                                        | Google Workspace SMTP as `billing@sugrpay.com`                           | mail adapter (`packages/server`)                                        |
| Payments                                     | Stripe Connect (test keys today)                                         | gateway adapter (`apps/sugrpay`)                                        |
| Accounting sync                              | Zoho Books (`.com` region)                                               | `apps/sugrpay/src/modules/zoho-sync`                                    |

### The processes

pm2 runs four processes, defined in
[deploy/ecosystem.config.cjs](../../deploy/ecosystem.config.cjs). Each API is
its own program ([decision 0005](../architecture/decisions/0005-separate-apis.md)).

| pm2 name         | What                                   | Port | Public name                |
| ---------------- | -------------------------------------- | ---- | -------------------------- |
| `platform-api`   | Platform API (`apps/platform`)         | 4001 | `platform-api.sugrpay.com` |
| `sugrpay-api`    | Sugrpay API (`apps/sugrpay`)           | 4002 | `sugrpay-api.sugrpay.com`  |
| `sugrpay-worker` | Sugrpay's background jobs (Zoho sync)  | —    | —                          |
| `hq-api`         | HQ API (`apps/hq`, a skeleton for now) | 4003 | `hq-api.sugrpay.com`       |

`api.sugrpay.com` is a front door: nginx passes each path to the API that owns
it, by the same rule as `apiServiceFor`
(`packages/platform-contracts/src/api-routing.ts`). Sugrpay owns `/dashboard`,
`/public`, `/webhooks/zoho`, `/integrations/zoho`, `/health/queues` and
`/brands/:id/(checks|customers|invoices|payments|settings|integrations/zoho)`;
everything else goes to the platform. So the Stripe and Zoho URLs registered
with those providers keep working unchanged.

The APIs call each other on the machine itself (`PLATFORM_INTERNAL_URL`,
`SUGRPAY_INTERNAL_URL`, `http://127.0.0.1:4001` / `:4002`) on `/internal/...`
routes. nginx refuses `/internal/` on every public name.

AWS account `839810213531`, region **us-west-1 (N. California)** for
everything except the S3 bucket (us-east-1).

## 2. Addresses

| Address                                      | What                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `https://www.sugrpay.com`                    | The web app. Sign-in at `/accounts/login`, sign-up at `/accounts/signup`, payment pages at `/pay/i/<token>` |
| `https://sugrpay.com`                        | Redirects to `https://www.sugrpay.com`, keeping the path (nginx on the EC2)                                 |
| `https://api.sugrpay.com`                    | The front door: every path, passed to the API that owns it                                                  |
| `https://platform-api.sugrpay.com`           | The platform API. Health: `/health`                                                                         |
| `https://sugrpay-api.sugrpay.com`            | The Sugrpay API. Health: `/health`                                                                          |
| `https://hq-api.sugrpay.com`                 | The HQ API (skeleton). Health: `/health`                                                                    |
| `https://api.13-56-132-111.sslip.io`         | The old single API by a free name (used before the domain)                                                  |
| `https://main.d2t9agxhkkuf4e.amplifyapp.com` | The web app's Amplify address                                                                               |

### DNS (GoDaddy, nameservers `ns71/ns72.domaincontrol.com`)

| Record                                    | Value                                                              | Purpose                                       |
| ----------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| A `@`                                     | `13.56.132.111`                                                    | bare domain → EC2 → redirect to www           |
| A `api`                                   | `13.56.132.111`                                                    | the API front door                            |
| A `platform-api`, `sugrpay-api`, `hq-api` | `13.56.132.111`                                                    | one name per API (needed for certificates)    |
| CNAME `www`                               | `d1rfo7yejiqhho.cloudfront.net`                                    | Amplify                                       |
| CNAME `_bf997b2d6ea31e745b229254a2868315` | `_2427dbb2fe2fab47f506e995762123ca.wzccmgtwzk.acm-validations.aws` | Amplify's SSL certificate — **keep**          |
| MX `@`                                    | `smtp.google.com`                                                  | Google Workspace email — **keep**             |
| TXT `@`                                   | `google-site-verification=…`                                       | Google — keep                                 |
| TXT `_dmarc`                              | `v=DMARC1; p=quarantine; …`                                        | email policy                                  |
| A `dashboard`, A `pay`                    | `54.176.157.40`                                                    | the old, switched-off system — can be deleted |

**Missing:** an SPF record (`TXT @ "v=spf1 include:_spf.google.com ~all"`) and
Google DKIM (`google._domainkey`). With DMARC at `quarantine`, emails may go to
spam until both exist.

GoDaddy cannot point a bare domain at Amplify (no ANAME/ALIAS), which is why
`@` points at the EC2 and nginx redirects — ignore Amplify's "@ ANAME" row.

## 3. Access

| To reach             | You need                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The EC2 over SSH     | the key pair `platform-key` (`platform-key.pem`) — **AWS cannot re-issue it; keep a copy safe**. `ssh -i platform-key.pem ubuntu@13.56.132.111` |
| The EC2 in a browser | AWS console → EC2 → `platform` → Connect → EC2 Instance Connect                                                                                 |
| AWS command line     | AWS console → CloudShell (already signed in)                                                                                                    |
| The databases        | only from the EC2 (they are not public). Credentials are in the EC2's `~/platform/.env`                                                         |
| GitHub deploys       | repository secret `EC2_SSH_KEY` (a deploy-only key, public half in the EC2's `~/.ssh/authorized_keys` as `github-actions-deploy@platform`)      |

The EC2's security group must allow SSH from GitHub's runners for automatic
deploys (port 22, and the key above is the only way in; password login is off).

## 4. Configuration (`~/platform/.env` on the EC2)

The template is [deploy/.env.production.example](../../deploy/.env.production.example);
every variable is explained in [.env.example](../../.env.example). Today:

| Setting                  | Value                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `APP_ENV`                | `production` (refuses the fake gateway, the console mailer and local storage)                                                  |
| Databases                | `PLATFORM_*` → RDS `platform`, `INVOICING_*` → RDS `invoicing-db`, all `sslmode=require`                                       |
| `REDIS_URL`              | `redis://localhost:6379`                                                                                                       |
| `PAYMENT_GATEWAY_DRIVER` | `stripe`                                                                                                                       |
| `ACCOUNTING_DRIVER`      | `zoho`, `ZOHO_SCHEDULED_PULL_ENABLED=true`                                                                                     |
| `MAIL_DRIVER`            | `smtp` via `smtp.gmail.com:587` as `billing@sugrpay.com`                                                                       |
| `STORAGE_DRIVER`         | `s3`                                                                                                                           |
| Ports                    | `PLATFORM_API_PORT=4001`, `SUGRPAY_API_PORT=4002`, `HQ_API_PORT=4003` (the defaults)                                           |
| Between the APIs         | `PLATFORM_INTERNAL_URL=http://127.0.0.1:4001`, `SUGRPAY_INTERNAL_URL=http://127.0.0.1:4002` (the defaults), `INTERNAL_API_KEY` |
| Public URLs              | API `https://api.sugrpay.com` (the front door); site `https://www.sugrpay.com`, `/accounts`, `/pay`                            |

**`INTERNAL_API_KEY`** is the shared secret the APIs send each other on
`/internal/...` routes. Production refuses to start without it, and it must be
at least 32 characters (`openssl rand -base64 32`). Without it Sugrpay cannot
resolve sessions and platform events cannot reach Sugrpay.

Secrets in it: database passwords, `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `INTERNAL_API_KEY`,
SMTP password (a Gmail **app password**), S3 keys, Stripe secret and webhook
secret, Zoho client secret. **Back up `CREDENTIAL_ENCRYPTION_KEY`**: it encrypts
stored integration credentials, and losing it means every brand reconnects.

The web app's settings live in Amplify → Environment variables
(`NEXT_PUBLIC_PLATFORM_API_URL`, `NEXT_PUBLIC_SUGRPAY_API_URL` — both fall back
to `NEXT_PUBLIC_API_URL`, the front door — `NEXT_PUBLIC_INVOICING_URL`, `NEXT_PUBLIC_ACCOUNTS_URL`,
`NEXT_PUBLIC_PAYMENT_PUBLIC_URL`, `NEXT_PUBLIC_ASSET_ORIGIN`,
`AMPLIFY_MONOREPO_APP_ROOT=apps/sugrpay`). They are built into the app:
change one, then rebuild.

## 5. Deploying

| What        | How                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app     | Push to `main` of sugrpay-frontend → Amplify builds and deploys (about 3 minutes)                                                                                                                |
| API         | Push to `main` of this repository → GitHub Actions ([deploy.yml](../../.github/workflows/deploy.yml)) runs the checks, then deploys over SSH. Until `EC2_SSH_KEY` is set it only runs the checks |
| API by hand | On the EC2: `cd ~/platform && git pull && bash deploy/deploy.sh` (the EC2 has no GitHub credentials of its own; the workflow fetches with its own token)                                         |

`deploy/deploy.sh` installs, builds the packages, **applies both databases'
migrations**, runs `pnpm db:move-zoho-connections` (copies Zoho Books
connections into Sugrpay's database; safe to repeat), compiles all three APIs
into `dist-build` beside the running versions, then swaps them in and reloads
pm2 — a failed build leaves the old versions running. The GitHub workflow then
checks health on ports 4001, 4002 and 4003.

The single API of before the split ran in pm2 as `api` and `worker` on port 4000. `deploy.sh` removes those two only once no file in
`/etc/nginx/sites-enabled/` sends anything to `127.0.0.1:4000`. To switch an
existing certbot-managed site over to routing by path, run
`sudo node deploy/production/route-front-door.mjs /etc/nginx/sites-enabled/<file>`,
then `sudo nginx -t && sudo systemctl reload nginx` (it keeps a copy of the
original as `../<file>.before-split`).

Deploy the API before the web app when a release changes both.

## 6. Everyday operations (on the EC2)

| Task                                 | Command                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is everything up?                    | `pm2 status` · `curl -s localhost:4001/health` · `curl -s localhost:4002/health` · `curl -s localhost:4003/health/live`                                                                                       |
| Logs                                 | `pm2 logs platform-api` · `pm2 logs sugrpay-api` · `pm2 logs sugrpay-worker` · `pm2 logs hq-api` (rotated: 20 MB × 14, compressed)                                                                            |
| Restart the APIs + worker            | `pm2 restart platform-api sugrpay-api sugrpay-worker hq-api`                                                                                                                                                  |
| Reboot the server                    | AWS console → Reboot instance (everything restarts by itself: pm2, nginx, Redis)                                                                                                                              |
| Change a secret or setting           | [deploy/production/update-secrets.sh](../../deploy/production/update-secrets.sh) — see its header; it validates the result before switching and keeps a backup                                                |
| Check an env file                    | `node deploy/production/check-env.mjs [.env]`                                                                                                                                                                 |
| Change the site or API address       | `bash deploy/set-public-urls.sh --site https://… ` / `--api https://…` (updates emails, payment links, OAuth callbacks; restarts)                                                                             |
| New HTTPS name                       | nginx block, then [deploy/production/request-certificate.sh](../../deploy/production/request-certificate.sh) `<name>` (retries while DNS caches catch up)                                                     |
| Certificates                         | Let's Encrypt for `api.sugrpay.com`, `platform-api.sugrpay.com`, `sugrpay-api.sugrpay.com`, `hq-api.sugrpay.com`, `sugrpay.com`; renewed automatically by `certbot.timer`. Check: `sudo certbot certificates` |
| nginx config                         | `/etc/nginx/sites-enabled/`. Templates in [deploy/nginx](../../deploy/nginx): `api.conf` (the four API names: `api`, `platform-api`, `sugrpay-api`, `hq-api`), `root-redirect.conf` (bare-domain redirect)    |
| Database migrations                  | run by `deploy.sh`; by hand `pnpm db:migrate` (both databases)                                                                                                                                                |
| A new RDS database server per module | [deploy/production/setup-separate-rds.sh](../../deploy/production/setup-separate-rds.sh) (production uses one RDS instance per module)                                                                        |

**Never run `pnpm db:seed` on a server**: it empties the tables it seeds.

## 7. Outside services

| Service                                                                       | Settings that point at us                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stripe** (test mode)                                                        | Connect → OAuth redirect `https://api.sugrpay.com/integrations/stripe/callback` (served by the platform API); webhook `https://api.sugrpay.com/public/webhooks/stripe` (served by the Sugrpay API; events on connected accounts: `payment_intent.succeeded`, `.processing`, `.payment_failed`, `.canceled`, `charge.refunded`). Going live: live keys + the same in live mode |
| **Zoho** (api-console.zoho.com, client `1000.CGA10GNZL4C0SMCWEEMPQ49DBUG2LQ`) | Authorized redirect `https://api.sugrpay.com/integrations/zoho/callback` (served by the Sugrpay API). Each brand connects from Brand Settings → Integrations → Zoho Books and adds the two webhook URLs it shows to Zoho Books                                                                                                                                                |
| **Google Workspace**                                                          | `billing@sugrpay.com` sends all email using an app password (2-Step Verification must stay on)                                                                                                                                                                                                                                                                                |
| **GoDaddy**                                                                   | DNS, section 2                                                                                                                                                                                                                                                                                                                                                                |

## 8. How sign-up works (and what depends on email)

1. `/accounts/signup` (name + email) → API creates the company, its owner
   (`INVITED`), the Sugrpay subscription and role, and emails a set-password
   link (24 h, single use).
2. The link → `/accounts/set-password` → the owner is `ACTIVE` and signed in.
3. First visit to Sugrpay: company details → brand structure (single / multi)
   → dashboard.

If the email cannot be sent the sign-up is undone and the page says so
(503). Signing up again before the password is set re-sends the link. Details:
[api/README.md](../api/README.md), code in
`apps/platform/src/modules/auth/application/auth.service.ts`.

## 9. Open items

| Item                                    | Status                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SPF + DKIM for sugrpay.com              | missing — emails may land in spam                                                                    |
| `EC2_SSH_KEY` GitHub secret             | not set — API deploys are by hand until it is                                                        |
| Stripe live keys                        | test keys in use                                                                                     |
| S3 bucket                               | a bucket named `invoice-dev-…` with access keys; a production bucket with an EC2 IAM role is cleaner |
| Credentials pasted in chat during setup | RDS master passwords, AWS access key, Stripe secret, Zoho secret, Gmail password — rotate them       |
| Old system                              | DNS `dashboard` and `pay` still point at its switched-off server                                     |
| Security hardening                      | three items in [api/test-report-2026-10-22.md](../api/test-report-2026-10-22.md#findings)            |
| Product gaps                            | [known-gaps.md](../known-gaps.md)                                                                    |
