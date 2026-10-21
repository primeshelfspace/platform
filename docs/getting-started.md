# Getting started

Everything needed to run the platform on your own machine, from an empty
computer to a running API. The web apps live in the separate
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
repository and run against this API. Works on Windows, macOS and Linux.

**Time needed:** about 20 minutes the first time, mostly installs.

---

## 1. What you are going to run

| Part             | What it is                                                   | Address               |
| ---------------- | ------------------------------------------------------------ | --------------------- |
| **API**          | The one backend (platform + every product)                   | http://localhost:4000 |
| **Mail catcher** | Shows every email the system sends (none leave your machine) | http://localhost:1080 |

They need three services underneath:

| Service        | Used for                                                | Port |
| -------------- | ------------------------------------------------------- | ---- |
| **PostgreSQL** | The databases (one per module: `platform`, `invoicing`) | 5432 |
| **Redis**      | Background job queues                                   | 6379 |
| **SMTP sink**  | Catches outgoing email (started for you)                | 1025 |

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
2. creates the module databases (`platform`, `invoicing`) and their logins;
3. creates all tables and security rules (migrations) and generates each
   module's database client;
4. loads demo data (two companies, four brands, users, invoices);
5. checks everything is reachable.

It ends with **"Ready in …s."** Run it again any time — it is safe to repeat.

---

## 6. Start the platform

```bash
pnpm dev
```

This builds the shared packages first, then starts the API, reloading on every
code change. Wait for the API to print
`api listening on http://localhost:4000`, then open:

- **http://localhost:4000/health** — should show `postgres:platform`, `postgres:invoicing` and `redis` as `up`
- **http://localhost:1080** — emails the system "sent"

Stop with **Ctrl+C**.

**Background jobs** (Zoho sync, scheduled tasks) run in a separate worker. You
only need it when working on those:

```bash
pnpm --filter @platform/api dev:worker
```

---

## 7. Sign in

The Sugrpay web app is in the
[sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
repository. With the API running, follow its README (`pnpm install`, copy
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
| `pnpm dev`                                               | Run everything with live reload                                  |
| `pnpm build`                                             | Production build of every app (cached — unchanged apps skip)     |
| `pnpm test`                                              | All tests (needs the services running and demo data loaded)      |
| `pnpm typecheck`                                         | Type-check every app and package                                 |
| `pnpm check`                                             | Everything before you push: format, dependencies, types, tests   |
| `pnpm format`                                            | Auto-format the code                                             |
| `pnpm boot-check`                                        | Prove the platform starts with no product, and with each product |
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

| Problem                                              | Fix                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'pnpm' is not recognized`                           | Close and reopen the terminal after installing; or `npm install -g pnpm@11.10.0` again.                                                                                                                                                            |
| `setup:local` says it could not create the databases | `DATABASE_ADMIN_URL` in `.env` must be a PostgreSQL **superuser** (see step 4).                                                                                                                                                                    |
| `postgres is not running on :5432`                   | Start Docker Desktop, or start the PostgreSQL service (Windows: _Services_ → `postgresql-x64-16`).                                                                                                                                                 |
| `redis is not running on :6379`                      | Start Docker Desktop, or the Memurai service on Windows.                                                                                                                                                                                           |
| Port 4000 is already in use                          | Set `API_PORT` and `API_PUBLIC_URL` in `.env`, and `NEXT_PUBLIC_API_URL` in the front end's `.env`. If a web app moves port, update `ADMIN_PUBLIC_URL`, `PAYMENT_PUBLIC_URL` or `ACCOUNTS_PUBLIC_URL` here. Restart `pnpm dev`.                    |
| A web page shows an error right after `pnpm dev`     | Wait until the API prints `api listening…`; the web apps start faster than the API.                                                                                                                                                                |
| Sign-in says the account is locked                   | Five wrong passwords lock it for 30 minutes. `pnpm db:seed` clears it.                                                                                                                                                                             |
| A test fails with "unique constraint"                | Some tests expect fresh demo data: run `pnpm db:seed`, then the tests again.                                                                                                                                                                       |
| `Cannot find module '…/generated/…'`                 | Run `pnpm db:generate`.                                                                                                                                                                                                                            |
| A `pnpm` command sits there doing nothing            | pnpm re-installs before running scripts when dependencies changed, and can wait on a hidden question. Stop it (Ctrl+C), run `pnpm install` on its own and answer any question (or run it with the environment variable `CI=true`), then try again. |

---

## Next

- How the code is organised: [architecture/README.md](architecture/README.md)
- Adding HQ or another product: [architecture/adding-a-product.md](architecture/adding-a-product.md)
- Moving an old single-database installation over: [architecture/databases.md](architecture/databases.md#commands)
