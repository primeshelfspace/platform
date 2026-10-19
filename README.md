# Platform

One platform, several products. The platform owns what every product needs —
sign-in, companies, brands, users, roles, integrations and audit — and each
product is built on top of it:

| Product     | What it does                          | Status             |
| ----------- | ------------------------------------- | ------------------ |
| **Sugrpay** | Send invoices and get paid            | Live               |
| **HQ**      | Products, stock, suppliers and stores | Next (placeholder) |

## Run it

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
pnpm setup:local          # services, databases, migrations, demo data
pnpm dev
```

Then open http://localhost:3002 (Accounts) and sign in as `owner@sugrpay.test` /
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
  accounts/               Accounts web app: sign-in, team, brands, locations, billing
  invoicing/              Sugrpay admin web app (Next.js)
  payment/                public payment pages (Next.js)
packages/
  kernel/                 money, calculations, tenancy, design tokens — used everywhere
  platform-contracts/     what the platform publishes (schemas, events)
  invoicing-contracts/    what Sugrpay publishes (schemas, statuses, email/PDF)
  hq-contracts/           what HQ will publish (placeholder)
  ui/                     React components shared by the web apps
docs/                     all documentation
deploy/                   staging deploy scripts
scripts/                  local setup and checks
```

Everything installs into one `node_modules` at the root; `pnpm dev`, `build`,
`test` and `typecheck` run across every app in the right order through
[Turborepo](https://turbo.build/repo).

## Documentation

| Read                                                               | For                                           |
| ------------------------------------------------------------------ | --------------------------------------------- |
| [docs/getting-started.md](docs/getting-started.md)                 | Running it locally, commands, troubleshooting |
| [docs/architecture/](docs/architecture/README.md)                  | Modules, layers, databases, events, decisions |
| [docs/guides/payment-flow.md](docs/guides/payment-flow.md)         | Testing invoice → payment                     |
| [docs/integrations/zoho-books.md](docs/integrations/zoho-books.md) | Connecting Zoho Books                         |
| [docs/known-gaps.md](docs/known-gaps.md)                           | Open decisions and dependencies               |
| [docs/README.md](docs/README.md)                                   | Everything else                               |

## Before you push

```bash
pnpm db:seed && pnpm check
```

`pnpm check` runs formatting, dependency, type and test checks — the same
things a CI pipeline would.
