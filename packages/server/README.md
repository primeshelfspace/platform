# Shared

Plumbing every module may use. Shared code never imports a product, and
reaches the platform only through its `public-api.ts` (enforced by
`src/module-boundaries.test.ts`).

| Folder      | What it holds                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapters/` | Ports to the outside world: payment gateways (fake, Stripe, Numbers), accounting (fake, Zoho Books), mail (SMTP, console), storage (local disk, S3). Bound in one place each; the environment chooses which. |
| `infra/`    | Event bus and outbox dispatcher, BullMQ queues, Redis, scoped-transaction helpers for the per-module Prisma services                                                                                         |
| `config/`   | The environment schema, validated once at boot                                                                                                                                                               |
| `common/`   | Small cross-cutting helpers: credential encryption, uploads, concurrency, validation pipe                                                                                                                    |
| `health/`   | Liveness/readiness endpoints; modules register their own probes                                                                                                                                              |
