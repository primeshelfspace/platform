# Architecture

**One platform, several products, one backend.** The platform owns what every
product needs — login, companies, brands, users, roles, subscriptions,
locations, integrations and audit. Each product (Sugrpay invoicing today, HQ next) is built
on top of it and never on top of another product.

The backend is a **modular monolith**: a single NestJS application made of
walled-off modules, each with **its own database**. Any module can later be run
as its own service without a rewrite (see
[decisions/0001](decisions/0001-modular-monolith.md)).

**Two repositories.** This one (`platform`) is the backend only: the API,
its databases and the packages it is built from. Every web app lives in
[primeshelfspace/sugrpay-frontend](https://github.com/primeshelfspace/sugrpay-frontend)
and reaches the backend only over HTTP. The front end keeps copies of
`kernel`, `platform-contracts` and `invoicing-contracts` (see its
`packages/README.md`); the copies here are the source of truth.

```mermaid
flowchart TB
  subgraph web["sugrpay-frontend repository — web apps (Next.js)"]
    ACC_APP["accounts<br/>sign-in · team · billing"]
    INV_APP["invoicing<br/>Sugrpay admin"]
    PAY_APP["payment<br/>public pay pages"]
    HQ_APP["hq<br/>(placeholder)"]
  end

  subgraph api["platform repository — apps/api, one NestJS backend"]
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

  ACC_APP --> api
  INV_APP --> api
  PAY_APP --> api
  HQ_APP -.-> api
  PLAT --> PDB
  INV --> IDB
  HQ -.-> HDB
```

There is deliberately no arrow between the two products.

## Read next

| Document                                         | Covers                                                   |
| ------------------------------------------------ | -------------------------------------------------------- |
| [principles.md](principles.md)                   | The rules that must not break: money, tenant isolation   |
| [modules.md](modules.md)                         | The module rules, public APIs, and the folder layout     |
| [layers.md](layers.md)                           | Clean architecture inside a feature (domain → interface) |
| [databases.md](databases.md)                     | One database per module, roles, row-level security       |
| [events.md](events.md)                           | The outbox, delivery guarantees, published events        |
| [products-and-access.md](products-and-access.md) | Subscriptions, roles per product, locations, one sign-in |
| [adding-a-product.md](adding-a-product.md)       | Step by step: bringing HQ (or any product) online        |
| [decisions/](decisions/)                         | Architecture decision records                            |

## Repository map

```
apps/
  api/                      the backend (modular monolith) + background worker
    src/
      modules/
        platform/           shared core: auth, companies, brands, users,
                            subscriptions, locations, tenancy,
                            integrations, audit, events
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
packages/
  kernel/                   money, calculation, tenancy scope + roles, design tokens,
                            port interfaces, generic validation and reference data
  platform-contracts/       what the platform publishes: request schemas, events
  invoicing-contracts/      what invoicing publishes: schemas, statuses, email/PDF renderers
  hq-contracts/             what HQ will publish (placeholder)
deploy/                     staging deploy (pm2 + build-slot script)
docs/                       this documentation, product specs, integration notes
scripts/                    local setup, services, boot check, dependency check
eslint.config.mjs           the import rules (module boundaries, layers)
```
