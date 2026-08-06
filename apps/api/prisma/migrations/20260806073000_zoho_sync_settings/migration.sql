-- FR-ZHO-030/011/012: per-brand pull cadence and per-object push gates.
--
-- pull_frequency_minutes replaces the single hardcoded 15-minute worker
-- interval with a value the 'scheduled-sync' cron checks per brand instead —
-- see worker.ts. 1 minute (the cron's own tick) is the honest floor for
-- "Realtime": pull is inherently polling, since Zoho sends this adapter no
-- webhooks.
--
-- customer_sync_enabled / invoice_sync_enabled gate ZohoSyncService's push
-- methods independently. Existing connections default to both true and the
-- prior fixed cadence, so nothing already connected changes behaviour the
-- moment this lands.
ALTER TABLE "integration_connection"
    ADD COLUMN "pull_frequency_minutes" INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN "customer_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "invoice_sync_enabled" BOOLEAN NOT NULL DEFAULT true;
