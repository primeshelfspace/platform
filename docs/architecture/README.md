# Architecture

**One platform, several products, one backend.** The platform owns what every
product needs — login, companies, brands, users, roles, integrations, audit and
(soon) subscriptions. Each product (Sugrpay invoicing today, HQ next) is built
on top of it and never on top of another product.

The backend is a **modular monolith**: a single NestJS application made of
walled-off modules, each with **its own database**. Any module can later be run
as its own service without a rewrite (see
[decisions/0001](decisions/0001-modular-monolith.md)).

```mermaid
flowchart TB
  subgraph web["Web apps (Next.js)"]
    INV_APP["apps/invoicing<br/>Sugrpay admin"]
    PAY_APP["apps/payment<br/>public pay pages"]
    HQ_APP["apps/hq<br/>(placeholder)"]
  end

  subgraph api["apps/api — one NestJS backend"]
    direction TB
    INV["modules/invoicing"]
    HQ["modules/hq<br/>(placeholder)"]
    PLAT["modules/platform"]
    SHARED["shared/<br/>adapters · infra · config · common · health"]
    INV -- "Ask: public-api.ts" --> PLAT
    HQ -. "Ask: public-api.ts" .-> PLAT
    PLAT -- "Tell: events (outbox)" --> INV
    PLAT -. "Tell: events" .-> HQ
    INV --> SHARED
    PLAT --> SHARED
  end

  PDB[("platform DB")]
  IDB[("invoicing DB")]
  HDB[("hq DB<br/>(later)")]

  INV_APP --> api
  PAY_APP --> api
  HQ_APP -.-> api
  PLAT --> PDB
  INV --> IDB
  HQ -.-> HDB
```

There is deliberately no arrow between the two products.

## Read next

| Document                                   | Covers                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| [modules.md](modules.md)                   | The module rules, public APIs, and the folder layout     |
| [layers.md](layers.md)                     | Clean architecture inside a feature (domain → interface) |
| [databases.md](databases.md)               | One database per module, roles, row-level security       |
| [events.md](events.md)                     | The outbox, delivery guarantees, published events        |
| [adding-a-product.md](adding-a-product.md) | Step by step: bringing HQ (or any product) online        |
| [decisions/](decisions/)                   | Architecture decision records                            |

## Repository map

```
apps/
  api/                      the backend (modular monolith) + background worker
    src/
      modules/
        platform/           shared core: auth, companies, brands, users,
                            tenancy, integrations, audit, events
        invoicing/          Sugrpay: customers, invoices, payments, pay API,
                            settings, Zoho sync, dashboard
        hq/                 HQ (placeholder)
      shared/               plumbing every module may use
        adapters/           ports to the outside world: payment gateway,
                            accounting (Zoho), mail, storage
        infra/              event bus + outbox dispatcher, queues, Redis,
                            scoped-transaction helpers
        config/             validated environment
        common/             small cross-cutting helpers
        health/             liveness/readiness endpoints
      app.module.ts         composition root (platform + ENABLED_PRODUCTS)
      main.ts               HTTP entry point
      worker.ts             queue worker entry point
    prisma/
      platform/             platform schema + migrations
      invoicing/            invoicing schema + migrations
      bootstrap.ts          creates module databases and roles
      seed.ts               development data for every module
      migrate-legacy.ts     one-off import of a pre-split database
  invoicing/                Next.js admin app for Sugrpay
  payment/                  Next.js public payment pages
  hq/                       HQ web app (placeholder)
packages/
  shared/                   money, calculation, domain types, validation schemas
  ui/                       shared React components
deploy/                     staging deploy (pm2 + build-slot script)
docs/                       this documentation, product specs, integration notes
scripts/                    local setup, services, dev runner, boot check
```
