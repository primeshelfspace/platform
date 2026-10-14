# 0001 — Modular monolith, one backend for every product

**Status:** accepted · Oct 2026

## Decision

Sugrpay, HQ and any later product share one platform and run in one NestJS
backend, split into walled-off modules (`platform`, `invoicing`, `hq`).

## Why

- Login, companies, brands, users, integrations and billing are built once.
- One deployment and one process keep cost and operations low while the
  products are young.
- Hard module walls (see [modules.md](../modules.md)) keep a later split cheap:
  a module can become its own service by replacing its `public-api.ts` with an
  HTTP client and its in-process events with a broker.

## When to split a module out

Only for a measured problem: one integration slowing everything down, volume
that needs its own scaling, compliance, or a team blocked by shared releases.
The likeliest first candidate is HQ's channel sync.

## Cost

One process means one failure domain. Mitigated by keeping long work (sync,
PDF rendering) in the separate worker process.
