# 0003 — Transactional outbox for events between modules

**Status:** accepted · Oct 2026

## Decision

A module publishes an event by writing an `outbox_event` row in the same
transaction as the change. `OutboxDispatcher` delivers due rows to the
in-process `EventBus` right after commit and on a short poll, with backoff on
failure. Handlers are idempotent (`processed_event`) and tolerate reordering
(snapshot versions).

## Why

- No lost or phantom events: the event exists exactly when the change
  committed.
- Read-your-writes in practice: the producer flushes before its API call
  returns, so the next request already sees the change in other modules.
- The same shape works with a message broker if a module is split out.

## Cost

Delivery is at-least-once, so every handler must check for duplicates. The
application role may only INSERT into the outbox; delivery runs on the owner
connection.
