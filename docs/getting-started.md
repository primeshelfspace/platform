# Getting started

Everything needed to run the platform on your own machine, from an empty
computer to running APIs. The web apps live in the separate
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
repository and run against these APIs. Works on Windows, macOS and Linux.

**Time needed:** about 20 minutes the first time, mostly installs.

---

## 1. What you are going to run

| Part               | What it is                                                                     | Address               |
| ------------------ | ------------------------------------------------------------------------------ | --------------------- |
| **Platform API**   | Sign-in, companies, brands, users, subscriptions, locations, integrations      | http://localhost:4001 |
| **Sugrpay API**    | Customers, invoices, payments, the payment page, Zoho Books                    | http://localhost:4002 |
| **HQ API**         | A skeleton: answers `/health` only                                             | http://localhost:4003 |
| **Sugrpay worker** | Sugrpay's background jobs (Zoho sync, scheduled tasks) — only when you need it | —                     |
| **Mail catcher**   | Shows every email the system sends (none leave your machine)                   | http://localhost:1080 |

Each API is its own program with its own database; see
[architecture/decisions/0005](architecture/decisions/0005-separate-apis.md).

They need three services underneath:

| Service        | Used for                                             | Port |
| -------------- | ---------------------------------------------------- | ---- |
| **PostgreSQL** | The databases (one per API: `platform`, `invoicing`) | 5432 |
| **Redis**      | Background job queues                                | 6379 |
| **SMTP sink**  | Catches outgoing email (started for you)             | 1025 |

---

## 2. Install the tools (once per computer)

| Tool       | Version                    | Check with       |
| ---------- | -------------------------- | ---------------- |
| Git        | any recent                 | `git --version`  |
| Node.js    | **22 or newer** (LTS)      | `node --version` |
| pnpm       | **11.10.0**                | `pnpm --version` |
| PostgreSQL | **16**                     | —                |
| Redis      | **7** (Memurai on Windows) | —                |

You can run PostgreSQL and Redis **either with Docker** (easiest, one command)
**or installed directly** on your computer. Pick one.

### Windows

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
npm install -g pnpm@11.10.0
```

Then **either** Docker:

```powershell
winget install --id Docker.DockerDesktop -e     # then start Docker Desktop once
```

**or** native services:

```powershell
winget install --id PostgreSQL.PostgreSQL.16 -e   # remember the superuser password you set
winget install --id Memurai.MemuraiDeveloper -e   # Redis-compatible; run as administrator
```

Close and reopen your terminal afterwards, so the new commands are found.

### macOS

```bash
brew install git node@22
npm install -g pnpm@11.10.0
brew install --cask docker                       # Docker path
# or the native path:
brew install postgresql@16 redis
```

### Linux (Debian/Ubuntu)

```bash
sudo apt install git
# Node 22: https://nodejs.org/en/download (or nvm)
npm install -g pnpm@11.10.0
# Docker: https://docs.docker.com/engine/install/  — or: sudo apt install postgresql-16 redis
```

---

## 3. Get the code

```bash
git clone https://github.com/primeshelfspace/platform.git
cd platform
pnpm install
```

`pnpm install` puts every library into one `node_modules` folder at the root.

---

## 4. Configure

```bash
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

The defaults work for local development. The one line you may need to change
is **`DATABASE_ADMIN_URL`** — a PostgreSQL _superuser_ used once, to create the
databases:

| You run PostgreSQL with… | Set `DATABASE_ADMIN_URL` to                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| Docker (docker-compose)  | `postgresql://sugrpay:sugrpay@localhost:5432/postgres` (default)          |
| A native install         | `postgresql://postgres:<your superuser password>@localhost:5432/postgres` |

Everything else in `.env` is explained by the comment above it.

---

## 5. Set everything up (one command)

If you chose **Docker**, start Docker Desktop first.

```bash
pnpm setup:local
```

This:

1. starts PostgreSQL, Redis and the mail catcher (Docker if it is available,
   otherwise your installed services);
2. creates the databases (`platform`, `invoicing`) and their logins;
3. creates all tables and security rules (migrations) and generates each
   API's database client;
4. loads demo data (two companies, four brands, users, invoices);
5. checks everything is reachable.

It ends with **"Ready in …s."** Run it again any time — it is safe to repeat.

---

## 6. Start the platform

```bash
pnpm dev
```

This builds the shared packages first, then starts the three APIs, reloading
on every code change. Wait for them to print
`platform API on http://localhost:4001` and
`Sugrpay API on http://localhost:4002`, then open:

- **http://localhost:4001/health** — should show `postgres:platform` and `redis` as `up`
- **http://localhost:4002/health** — should show `postgres:invoicing`, `queues` and `redis` as `up`
- **http://localhost:1080** — emails the system "sent"

Stop with **Ctrl+C**.

Signed-in Sugrpay requests ask the platform API who the session belongs to,
so run both (`pnpm dev` does).

**Background jobs** (Zoho sync, scheduled tasks) run in Sugrpay's separate
worker. You only need it when working on those:

```bash
pnpm --filter @platform/sugrpay-api dev:worker
```

---

## 7. Sign in

The Sugrpay web app is in the
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
repository. It calls the platform API (`NEXT_PUBLIC_PLATFORM_API_URL`) and the
Sugrpay API (`NEXT_PUBLIC_SUGRPAY_API_URL`), sending each call to the one
that owns its path. With the APIs running, follow its README (`pnpm install`, copy
`.env.example` to `.env`, `pnpm dev`), then open **http://localhost:3000**
and sign in (the sign-in page is at `/accounts/login`). Every demo user has
the password **`sugrpay-dev-password`**. Team, brands, locations and billing
are under `/accounts`; customer payment pages under `/pay`.

| Email                    | Role        | Sees brands                |
| ------------------------ | ----------- | -------------------------- |
| owner@sugrpay.test       | Owner       | all                        |
| admin@sugrpay.test       | Admin       | all                        |
| brand.admin@sugrpay.test | Brand admin | Solstice, Meridian         |
| finance@sugrpay.test     | Finance     | Solstice, Meridian, Cobalt |
| sales@sugrpay.test       | Sales       | Solstice                   |
| readonly@sugrpay.test    | Read only   | Solstice, Cobalt           |

Every demo company subscribes to Sugrpay, and every demo user has a Sugrpay
role equal to the role above. The demo company also has four locations (a
store per brand and a central warehouse). As the owner, try **Billing** →
turn HQ on, then **Team** → give someone an HQ role or a location.

The first time the owner opens Sugrpay, it asks how the company's brands are
organised (one brand or several) — pick **Multi-brand** to see all the demo
brands.

**Try the main flow:** Customers → _Add customer_ → Invoices → _Create
invoice_ → _Create & issue_ → open the payment link → pay. No real money moves:
payments go through a built-in fake gateway. Make the amount end in **11** to
see a decline, **22** for a pending bank transfer, **33** for a timeout.

---

## 8. Everyday commands

| Command                                                  | What it does                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                                               | Run all three APIs with live reload                              |
| `pnpm build`                                             | Production build of every app (cached — unchanged apps skip)     |
| `pnpm test`                                              | All tests (needs the services running and demo data loaded)      |
| `pnpm typecheck`                                         | Type-check every app and package                                 |
| `pnpm check`                                             | Everything before you push: format, dependencies, types, tests   |
| `pnpm format`                                            | Auto-format the code                                             |
| `pnpm boot-check`                                        | Prove each API starts on its own                                 |
| `pnpm services:up` / `services:down` / `services:status` | Start / stop / show local services                               |
| `pnpm db:seed`                                           | Reset the demo data                                              |
| `pnpm db:migrate`                                        | Apply new database migrations                                    |
| `pnpm db:reset`                                          | Wipe and rebuild every local database (refuses remote databases) |
| `pnpm db:studio:platform` / `db:studio:invoicing`        | Browse a database in the browser                                 |

Before pushing, run **`pnpm db:seed && pnpm check`**.

---

## 9. After restarting your computer

Docker and native PostgreSQL/Redis services usually start on their own; the
mail catcher does not. Run:

```bash
pnpm services:up
pnpm dev
```

---

## 10. Troubleshooting

| Problem                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'pnpm' is not recognized`                           | Close and reopen the terminal after installing; or `npm install -g pnpm@11.10.0` again.                                                                                                                                                                                                                                                                                                                                                |
| `setup:local` says it could not create the databases | `DATABASE_ADMIN_URL` in `.env` must be a PostgreSQL **superuser** (see step 4).                                                                                                                                                                                                                                                                                                                                                        |
| `postgres is not running on :5432`                   | Start Docker Desktop, or start the PostgreSQL service (Windows: _Services_ → `postgresql-x64-16`).                                                                                                                                                                                                                                                                                                                                     |
| `redis is not running on :6379`                      | Start Docker Desktop, or the Memurai service on Windows.                                                                                                                                                                                                                                                                                                                                                                               |
| Port 4001, 4002 or 4003 is already in use            | Set `PLATFORM_API_PORT`, `SUGRPAY_API_PORT` or `HQ_API_PORT` in `.env`. For the platform or Sugrpay, also set `PLATFORM_INTERNAL_URL` / `SUGRPAY_INTERNAL_URL` (and `API_PUBLIC_URL` for the platform) here, and `NEXT_PUBLIC_PLATFORM_API_URL` / `NEXT_PUBLIC_SUGRPAY_API_URL` in the front end's `.env`. If a web app moves port, update `ADMIN_PUBLIC_URL`, `PAYMENT_PUBLIC_URL` or `ACCOUNTS_PUBLIC_URL` here. Restart `pnpm dev`. |
| A web page shows an error right after `pnpm dev`     | Wait until the APIs print `… API on http://localhost:…`; the web apps start faster than the APIs.                                                                                                                                                                                                                                                                                                                                      |
| Signed-in Sugrpay pages answer 503                   | The Sugrpay API cannot reach the platform API: check it is running and that `PLATFORM_INTERNAL_URL` points at it.                                                                                                                                                                                                                                                                                                                      |
| Sign-in says the account is locked                   | Five wrong passwords lock it for 30 minutes. `pnpm db:seed` clears it.                                                                                                                                                                                                                                                                                                                                                                 |
| A test fails with "unique constraint"                | Some tests expect fresh demo data: run `pnpm db:seed`, then the tests again.                                                                                                                                                                                                                                                                                                                                                           |
| `Cannot find module '…/generated/…'`                 | Run `pnpm db:generate`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| A `pnpm` command sits there doing nothing            | pnpm re-installs before running scripts when dependencies changed, and can wait on a hidden question. Stop it (Ctrl+C), run `pnpm install` on its own and answer any question (or run it with the environment variable `CI=true`), then try again.                                                                                                                                                                                     |

---

## Next

- How the code is organised: [architecture/README.md](architecture/README.md)
- Adding HQ or another product: [architecture/adding-a-product.md](architecture/adding-a-product.md)
- Moving an old single-database installation over: [architecture/databases.md](architecture/databases.md#commands)
