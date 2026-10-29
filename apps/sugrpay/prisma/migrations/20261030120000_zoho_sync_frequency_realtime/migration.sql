-- Sync Frequency (FR-ZHO-030): 0 is Real-time, no timed pull (Zoho's webhooks
-- bring changes in). It is the new default.
--
-- Every existing brand becomes Real-time. Timed pulls were switched off on
-- this platform (ZOHO_SCHEDULED_PULL_ENABLED=false) when this shipped, so this
-- keeps what each brand actually did; the old 1-minute "Realtime" was a pull
-- every minute, which is what the new Real-time replaces. A brand that wants
-- a timed pull picks an interval in Brand Settings.

ALTER TABLE "zoho_connection" ALTER COLUMN "pull_frequency_minutes" SET DEFAULT 0;
UPDATE "zoho_connection" SET "pull_frequency_minutes" = 0;
