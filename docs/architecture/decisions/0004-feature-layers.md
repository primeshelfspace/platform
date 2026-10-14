# 0004 — Clean-architecture layers inside each feature

**Status:** accepted · Oct 2026

## Decision

Every feature folder is organised as `domain/`, `application/`,
`infrastructure/` and `interface/`, with dependencies pointing inward (see
[layers.md](../layers.md)).

## Why

- A reader finds things by role: endpoints in `interface/`, use cases in
  `application/`, rules in `domain/`, I/O in `infrastructure/`.
- Business rules can be tested without a database or HTTP.
- Swapping an external system touches `infrastructure/` only.

## Cost

More folders per feature. Moving existing inline Prisma queries into
repositories is done gradually, feature by feature, never as a big-bang
rewrite.
