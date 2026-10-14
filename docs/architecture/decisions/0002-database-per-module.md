# 0002 — One database per module

**Status:** accepted · Oct 2026 · amends the original plan's "one database,
three schemas"

## Decision

Each module has its own PostgreSQL database with its own schema, migrations,
generated client and roles. A module's runtime role cannot connect to another
module's database. Modules exchange data only through public APIs and events.

## Why

- Isolation is physical, not a convention: no query, join or foreign key can
  cross modules, even by mistake.
- Splitting a module into its own service needs no database migration step.

## Cost

- No cross-database foreign keys. A product stores platform ids (brand, user)
  and keeps read-only copies of what it must join to, fed by events.
- A change and its audit entry in another module's database cannot share a
  transaction; the audit entry is written immediately after, and a failure to
  write it is logged as an error.
- Each database needs its own row-level security setup and migrations.
