# Platform (backend)

The backend for every product: one API and its databases. The platform owns
what every product needs — sign-in, companies, brands, users, roles,
subscriptions, locations, integrations and audit — and each product is built
on top of it:

| Product     | What it does                          | Status             |
| ----------- | ------------------------------------- | ------------------ |
| **Sugrpay** | Send invoices and get paid            | Live               |
| **HQ**      | Products, stock, suppliers and stores | Next (placeholder) |

**The web apps are in a separate repository:**
[primeshelfspace/sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
(Accounts, the Sugrpay admin app and the payment pages). They call this API
over HTTP.

## Run it

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
pnpm setup:local          # services, databases, migrations, demo data
pnpm dev
```

The API answers at http://localhost:4000/health. Then start the web apps from
the sugrpay-frontend repository and sign in there as `owner@sugrpay.test` /
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
deploy/                   staging deploy scripts
scripts/                  local setup and checks
```

Everything installs into one `node_modules` at the root; `pnpm dev`, `build`,
`test` and `typecheck` run across the API and packages in the right order through
[Turborepo](https://turbo.build/repo).

## Documentation

| Read                                                               | For                                           |
| ------------------------------------------------------------------ | --------------------------------------------- |
| [docs/getting-started.md](docs/getting-started.md)                 | Running it locally, commands, troubleshooting |
| [docs/architecture/](docs/architecture/README.md)                  | Modules, layers, databases, events, decisions |
| [docs/guides/payment-flow.md](docs/guides/payment-flow.md)         | Testing invoice → payment                     |
| [docs/guides/deploy-ec2.md](docs/guides/deploy-ec2.md)             | Deploying to AWS (EC2, RDS, Redis, S3, SES)   |
| [docs/integrations/zoho-books.md](docs/integrations/zoho-books.md) | Connecting Zoho Books                         |
| [docs/known-gaps.md](docs/known-gaps.md)                           | Open decisions and dependencies               |
| [docs/README.md](docs/README.md)                                   | Everything else                               |

## Before you push

```bash
pnpm db:seed && pnpm check
```

`pnpm check` runs formatting, dependency, type and test checks — the same
things a CI pipeline would.
