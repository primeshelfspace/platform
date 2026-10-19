# Modules

A **module** is a top-level folder under `apps/api/src/modules/`: `platform`,
`invoicing`, `hq`. Everything a module owns — its code, its database, its
events — lives inside it.

## The rules

1. **Each table belongs to exactly one module**, in that module's own
   database. No other module reads or writes it.
2. **One-way dependencies.** Products depend on the platform. The platform
   never depends on a product. Products never depend on each other.
3. **Talk only through contracts:**
   - **Ask** — call the other module's `public-api.ts` (an answer is needed now).
   - **Tell** — publish an event (something happened). See [events.md](events.md).
4. **Copy what you need to keep.** A module that needs another module's data
   for joins or history keeps its own copy, fed by events (invoicing's
   read-only `brand` table), or stores the value at the time it was used (an
   invoice keeps the item name and price it was issued with).

## Enforced by the build

Every rule is checked twice: by the linter as you type (`pnpm lint`,
`eslint.config.mjs`) and by the test suite (`src/module-boundaries.test.ts`).

| Check                                                                    | Where                                    |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| Platform never imports a product (code or contracts package)             | `pnpm lint`, `module-boundaries.test.ts` |
| Products never import each other                                         | `pnpm lint`, `module-boundaries.test.ts` |
| Shared code never imports a product                                      | `pnpm lint`, `module-boundaries.test.ts` |
| Only `public-api.ts` / `modules.ts` are importable from outside a module | `pnpm lint`, `module-boundaries.test.ts` |
| Feature layers: pure domain, interface never touches data directly       | `pnpm lint`, `module-boundaries.test.ts` |
| The kernel depends on nothing above it; web apps never import `apps/api` | `pnpm lint`                              |
| A module's database role can't reach another module's database           | `modules/*/…/rls.test.ts`                |
| The platform boots with no product enabled                               | `pnpm boot-check`                        |

## A module's entry points

| File            | Purpose                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public-api.ts` | Building blocks other code may use: services, decorators, types, event contracts. If the module is ever split into its own service, this is what becomes an HTTP client. |
| `modules.ts`    | The module's Nest modules, for wiring only (composition root, DI imports). Kept apart from `public-api.ts` so importing a decorator never loads the whole module graph.  |
| `README.md`     | What the module owns, what it exposes, what it listens to.                                                                                                               |

Everything else inside a module is private and can change freely.

Tests (`*.test.ts`) and test helpers (`*.test-support.ts`) may reach another
module's internals to build fixtures; the direction rules still apply to them.

## Inside a module

```
modules/<module>/
  public-api.ts        what other modules may use
  modules.ts           Nest modules for wiring
  <module>.module.ts   aggregates the module's feature modules
  database/            this module's Prisma client, service, RLS tests
  events/              events this module publishes (contracts) — platform today
  <feature>/           one folder per feature (invoices, payments, auth, ...)
                       organised in layers — see layers.md
  README.md
```

## Choosing products at runtime

`ENABLED_PRODUCTS` (comma-separated, default `invoicing`) selects which product
modules a process loads. The platform always loads. An empty value runs the
platform alone, which is how `pnpm boot-check` proves rule 2 holds at runtime, not just at
import time.
