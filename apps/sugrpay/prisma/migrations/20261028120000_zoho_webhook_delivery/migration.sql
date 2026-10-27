-- Last accepted Zoho webhook delivery, persisted on the connection row
-- itself rather than only cached in Redis (zoho:webhook-last-delivery:*,
-- 30-day TTL) — the "is Zoho actually calling us?" panel used to go
-- permanently blank on a cache flush or 30 days of Zoho silence, with no way
-- to recover the last-known value.

ALTER TABLE "zoho_connection" ADD COLUMN "last_webhook_delivery" JSONB;
