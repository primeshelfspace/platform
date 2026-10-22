# Platform (backend)

The backend for every product: one API and its databases. The platform owns
what every product needs — sign-in, companies, brands, users, roles,
subscriptions, locations, integrations and audit — and each product is built
on top of it:

| Product     | What it does                          | Status             |
| ----------- | ------------------------------------- | ------------------ |
| **Sugrpay** | Send invoices and get paid            | Live               |
| **HQ**      | Products, stock, suppliers and stores | Next (placeholder) |

**The web app is in a separate repository:**
[primeshelfspace/sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
— one Next.js app: the Sugrpay admin at `/`, sign-in and team at `/accounts`,
payment pages at `/pay`. It calls this API over HTTP.

**Live:** site https://www.sugrpay.com, API https://api.sugrpay.com — see
[docs/operations/production.md](docs/operations/production.md).

## Run it

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
pnpm setup:local          # services, databases, migrations, demo data
pnpm dev
```

The API answers at http://localhost:4000/health. Then start the web app from
the sugrpay-frontend repository (http://localhost:3000) and sign in as `owner@sugrpay.test` /
`sugrpay-dev-password`.

**New machine, or something not working?** Follow the full guide:
[docs/getting-started.md](docs/getting-started.md) — prerequisites for
Windows, macOS and Linux, configuration, every command, and troubleshooting.

## How it is built

A **modular monolith**: one NestJS backend made of walled-off modules —
`platform` plus one module per product — each with **its own PostgreSQL
database**. Modules talk only through each other's public API or through
events, and every feature is organised in clean-architecture layers. Tests
enforce all of it.

```
apps/
  api/                    the one backend
    src/modules/platform/   sign-in, companies, brands, users, subscriptions, locations,
                            integrations, audit, events
    src/modules/invoicing/  Sugrpay: customers, invoices, payments, settings, Zoho sync
    src/modules/hq/         HQ (placeholder)
    src/shared/             adapters, infrastructure, config, health
packages/
  kernel/                 money, calculations, tenancy, design tokens — used everywhere
  platform-contracts/     what the platform publishes (schemas, events)
  invoicing-contracts/    what Sugrpay publishes (schemas, statuses, email/PDF)
  hq-contracts/           what HQ will publish (placeholder)
docs/                     all documentation
deploy/                   server deploy, nginx configs, production helpers
.github/workflows/        deploy.yml: checks, then deploy on push to main
scripts/                  local setup and checks
```

Everything installs into one `node_modules` at the root; `pnpm dev`, `build`,
`test` and `typecheck` run across the API and packages in the right order through
[Turborepo](https://turbo.build/repo).

## Documentation

| Read                                                               | For                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| [docs/getting-started.md](docs/getting-started.md)                 | Running it locally, commands, troubleshooting          |
| [docs/developer-guide.md](docs/developer-guide.md)                 | How the code works, where things are, how to change it |
| [docs/operations/production.md](docs/operations/production.md)     | The live system and how to operate it                  |
| [docs/architecture/](docs/architecture/README.md)                  | Modules, layers, databases, events, decisions          |
| [docs/guides/payment-flow.md](docs/guides/payment-flow.md)         | Testing invoice → payment                              |
| [docs/guides/deploy-ec2.md](docs/guides/deploy-ec2.md)             | Deploying to AWS (EC2, RDS, Redis, S3, SES)            |
| [docs/api/README.md](docs/api/README.md)                           | The API: every endpoint, how to call it, test report   |
| [docs/integrations/zoho-books.md](docs/integrations/zoho-books.md) | Connecting Zoho Books                                  |
| [docs/known-gaps.md](docs/known-gaps.md)                           | Open decisions and dependencies                        |
| [docs/README.md](docs/README.md)                                   | Everything else                                        |

## Before you push

```bash
pnpm db:seed && pnpm check
```

`pnpm check` runs formatting, dependency, type and test checks — the same
things a CI pipeline would.
