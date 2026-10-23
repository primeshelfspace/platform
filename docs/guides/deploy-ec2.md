# Deploying to AWS (EC2)

How to run the whole system — this backend and the
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend) web
apps — on one EC2 server, with managed PostgreSQL, Redis, file storage and
email. Do it once per environment: **staging and production each get their
own copy of everything below.** They never share a database.

**Time needed:** about half a day the first time, mostly waiting on AWS (SES
production access can take a day).

---

## 1. What you are building

```
                 ┌──────────────────────────────┐
 Internet ──────►│  EC2 (this repository)       │──► RDS PostgreSQL (platform, invoicing)
   https://api.… │  nginx :443 → :4001 platform │──► Redis (job queues)
                 │              :4002 sugrpay   │──► S3 (logos, check images)
                 │              :4003 hq        │──► email (SMTP), Stripe, Zoho
                 │  pm2: platform-api,          │
                 │  sugrpay-api, sugrpay-worker,│
                 │  hq-api                      │
                 └──────────────────────────────┘
                              ▲
                              │ HTTPS
                 ┌────────────┴─────────────┐
 Internet ──────►│  AWS Amplify             │   the Sugrpay web app (sugrpay-frontend):
   https://<site>│  one Next.js app         │   /  ·  /accounts/…  ·  /pay/…
                 └──────────────────────────┘
```

The EC2 runs only the backend. The Sugrpay web app is one app on one address,
hosted on Amplify — see sugrpay-frontend's
[deploy/amplify.md](https://github.com/primeshelfspace/sugrpay-frontend/blob/main/deploy/amplify.md).
After it is up, tell the backend its address:
`bash deploy/set-public-urls.sh --site https://<site>`.

The backend is three APIs, each its own program and port
([decision 0005](../architecture/decisions/0005-separate-apis.md)). nginx
gives each its own name and keeps one **front door** name that accepts every
path and passes it to the API that owns it:

| Name (production)          | Goes to                        |
| -------------------------- | ------------------------------ |
| `platform-api.sugrpay.com` | platform API, `127.0.0.1:4001` |
| `sugrpay-api.sugrpay.com`  | Sugrpay API, `127.0.0.1:4002`  |
| `hq-api.sugrpay.com`       | HQ API, `127.0.0.1:4003`       |
| `api.sugrpay.com`          | by path (`apiServiceFor`)      |

The front-door host in this guide is `api.primeshelfspace.com`; use your own
names (or free `<name>.<ip-with-dashes>.sslip.io` names until you have a
domain).

---

## 2. What to create in AWS

Create everything in **one region** (the examples use `us-east-1`) and **one
VPC**.

| Resource        | Choose                                                                                   | Roughly / month |
| --------------- | ---------------------------------------------------------------------------------------- | --------------- |
| **EC2**         | `t3.large` (2 vCPU, 8 GB), Ubuntu 24.04 **x86_64**, 30 GB gp3 disk, an Elastic IP        | $60             |
| **RDS**         | **One** PostgreSQL 16 instance, `db.t4g.small`, 20 GB gp3, automated backups on (7 days) | $30             |
| **ElastiCache** | Redis OSS 7, `cache.t4g.micro`, one node, with the `noeviction` parameter group (below)  | $12             |
| **S3**          | One private bucket, Block Public Access fully on                                         | cents           |
| **SES**         | Your domain verified, production access requested                                        | cents           |
| **Route 53**    | An A record for the API host → the Elastic IP (none needed with sslip.io)                | $1              |

**About $115 a month per environment.** For a cheap staging box you can drop
ElastiCache and run Redis on the EC2 itself (`sudo apt install redis-server`,
`REDIS_URL=redis://localhost:6379`), and use `db.t4g.micro` — about $45.

### Why these sizes

- **EC2 size.** The box runs the three APIs and the worker and starts a headless
  Chrome to render invoice PDFs; `t3.small` (2 GB, with 2 GB swap) is enough
  for that. The web app builds on Amplify, not here. (Running the web app on
  this box too needs `t3.large`: each `next build` takes 1.5–2 GB
  on its own. 4 GB (`t3.medium`) works only with swap and slow deploys.
- **x86_64, not ARM (Graviton).** Puppeteer downloads its own Chrome at
  install time, and there is no Linux ARM build of it.
- **One RDS instance, two databases.** Each API has its own _database_
  (`platform`, `invoicing`), not its own server. `pnpm db:bootstrap` creates
  both, with separate logins, on one instance. Move one to its own
  instance later only if it needs it; only its URLs change.
- **A separate RDS instance per environment.** Never point staging and
  production at the same instance. `pnpm db:seed` empties every table it
  seeds, and the destructive-reset guard in `scripts/` exists because a reset
  once wiped a shared database.

### Security groups

| Group   | Inbound                                            |
| ------- | -------------------------------------------------- |
| `web`   | 80 and 443 from anywhere; 22 from **your IP only** |
| `db`    | 5432 from the `web` group only                     |
| `cache` | 6379 from the `web` group only                     |

Don't make RDS or ElastiCache publicly accessible.

### RDS notes

- Note the **master username and password**: they become `DATABASE_ADMIN_URL`,
  used once by `pnpm db:bootstrap`.
- PostgreSQL 16 on RDS requires TLS. Add `sslmode=require` to every database
  URL (the template already does).
- If bootstrap stops with `must be able to SET ROLE "platform_owner"`, the RDS
  master is not a true superuser and needs to be allowed to act as the roles it
  creates. Connect once as the master and run
  `ALTER ROLE <master> SET createrole_self_grant = 'set, inherit';`, then
  re-run `pnpm db:bootstrap` (it is safe to repeat).

### ElastiCache notes

BullMQ refuses to work on a Redis that may evict keys. Create a **parameter
group** from `default.redis7`, set `maxmemory-policy` to `noeviction`, and
attach it to the cluster. Leave in-transit encryption off inside the VPC so the
URL stays `redis://…:6379` (with it on, use `rediss://`).

### S3 and the instance role

Create an **IAM role** for the EC2 instance with this policy, and attach it to
the instance. The API then uses the role and no access keys are stored on the
box.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    }
  ]
}
```

Objects are written private and read through short-lived signed URLs, so the
bucket needs no bucket policy and no public access.

### SES

1. Verify the domain you send from (SES → Identities), and add the DKIM and
   SPF records it gives you.
2. Request **production access** — until then SES only delivers to addresses
   you have verified.
3. Create **SMTP credentials** (SES → SMTP settings). These go in `SMTP_USER`
   and `SMTP_PASSWORD`; the host is `email-smtp.<region>.amazonaws.com`, port 587.

---

## 3. Prepare the server (once)

SSH in as `ubuntu`, then:

```bash
# Node 22, pnpm 11.10 and pm2. pnpm must land at /usr/bin/pnpm — both
# repositories' pm2 configs start the apps through that path.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx
sudo npm install -g pnpm@11.10.0 pm2
which pnpm        # must print /usr/bin/pnpm

# Libraries headless Chrome needs to render invoice PDFs (Ubuntu 24.04 names)
sudo apt-get install -y libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation

# Restart pm2's processes when the server reboots
pm2 startup systemd -u ubuntu --hp /home/ubuntu   # run the command it prints
```

Get the backend:

```bash
cd ~
git clone https://github.com/primeshelfspace/platform.git
```

---

## 4. Configure the backend

```bash
cd ~/platform
cp deploy/.env.production.example .env
nano .env
```

Fill in every `CHANGE-ME` (the template explains each one). For the four
database passwords and the two secrets, generate fresh values:

```bash
openssl rand -hex 24          # one per database password
openssl rand -base64 32       # SESSION_SECRET, CREDENTIAL_ENCRYPTION_KEY, INTERNAL_API_KEY (one each)
```

`INTERNAL_API_KEY` is the secret the APIs send each other on their
`/internal/...` routes; production refuses to start without it (at least 32
characters). The ports (`PLATFORM_API_PORT`, `SUGRPAY_API_PORT`,
`HQ_API_PORT`) and the addresses the APIs call each other on
(`PLATFORM_INTERNAL_URL`, `SUGRPAY_INTERNAL_URL`) default to 4001/4002/4003 on
`127.0.0.1`. `API_PUBLIC_URL` is the front door (`https://api.primeshelfspace.com`).

**Save `CREDENTIAL_ENCRYPTION_KEY` in your password manager.** It encrypts the
stored Stripe, Square, Authorize.net and Zoho credentials. Lose it and every
brand has to reconnect every integration.

Keep the file private: `chmod 600 .env`.

---

## 5. Create the databases and start the backend

```bash
cd ~/platform
pnpm install --frozen-lockfile
pnpm db:bootstrap             # once: creates the databases and their logins
bash deploy/deploy.sh         # builds, migrates, starts the APIs + worker under pm2
curl -s localhost:4001/health # platform API
curl -s localhost:4002/health # Sugrpay API
curl -s localhost:4003/health/live # HQ API
```

The platform's `/health` should report `postgres:platform`, `redis` and
`storage` as `up`; Sugrpay's `postgres:invoicing`, `queues`, `redis` and
`storage`. If an API refuses to start, its log lists what is missing:
`pm2 logs platform-api --lines 50` (or `sugrpay-api`, `sugrpay-worker`,
`hq-api`).

**Don't run `pnpm db:seed` on a server.** It replaces the data with demo data.
It refuses when `APP_ENV=production`, but staging is not protected.

The Sugrpay web app deploys on Amplify, separately — see
[sugrpay-frontend/deploy/amplify.md](https://github.com/primeshelfspace/sugrpay-frontend/blob/main/deploy/amplify.md).

---

## 6. nginx and HTTPS

```bash
sudo cp ~/platform/deploy/nginx/api.conf /etc/nginx/sites-available/api.conf
# Set the four server_name lines in it to your names
sudo ln -s /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Certificates for every name. Certbot adds the HTTPS server blocks and the
# HTTP → HTTPS redirects, and renews on its own.
sudo certbot --nginx -d api.primeshelfspace.com -d platform-api.primeshelfspace.com \
  -d sugrpay-api.primeshelfspace.com -d hq-api.primeshelfspace.com
```

Each DNS record must already point at the Elastic IP (an sslip.io name always
does), or certbot cannot prove you own the name. The config refuses
`/internal/` on every name: those routes are only for the APIs calling each
other on the machine itself.

---

## 7. Connect the outside services

| Service | Set up                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe  | Settings → Connect → OAuth: add the redirect URI `https://api.primeshelfspace.com/integrations/stripe/callback`.                                                                                                                                                                                                                     |
| Stripe  | Developers → Webhooks: one endpoint, **"Events on Connected accounts"**, URL `https://api.primeshelfspace.com/public/webhooks/stripe`, events `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`. Its signing secret is `STRIPE_WEBHOOK_SECRET`. |
| Zoho    | In the Zoho API console app, add `https://api.primeshelfspace.com/integrations/zoho/callback` as a redirect URI.                                                                                                                                                                                                                     |
| Square  | If used: add `https://api.primeshelfspace.com/integrations/square/callback` on the Square application.                                                                                                                                                                                                                               |

These all use the front door: it passes the Stripe and Square callbacks to the
platform API and the Stripe webhook and Zoho callback to the Sugrpay API.

Use Stripe **test** keys on staging and **live** keys on production only.

---

## 8. Every release

On the server:

```bash
cd ~/platform && git pull && bash deploy/deploy.sh
```

It migrates both databases, builds all three APIs beside the running versions
and switches over only when every build succeeded, so a failed build leaves
the old versions serving. The Sugrpay web
app redeploys on Amplify by itself on every push to sugrpay-frontend's `main`.

| Check           | Command                                                                |
| --------------- | ---------------------------------------------------------------------- |
| What is running | `pm2 status`                                                           |
| A process's log | `pm2 logs platform-api` (or `sugrpay-api`, `sugrpay-worker`, `hq-api`) |
| Backend health  | `curl -s localhost:4001/health` · `curl -s localhost:4002/health`      |

---

## 9. Before real customers use production

These are open in the code today (see also [known-gaps.md](../known-gaps.md)):

- **Card fee on post-tax totals** is regulated in some US states (Q-01). Get an
  answer before switching card fees on.
- **No CI.** Run `pnpm check` in both repositories before each release.
- **Reminders and overdue marking are not automated yet.** Those scheduled
  jobs are defined but not implemented.
- **Back up the RDS instance.** Automated backups are on with the settings
  above; test a restore once.
