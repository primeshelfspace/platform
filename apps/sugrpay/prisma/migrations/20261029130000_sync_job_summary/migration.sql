-- What a sync log row is about, in words: "78 contacts, 78 saved" for a list
-- scan, or the customer name / invoice number for a single record. The log
-- now has one row per Zoho call, so a scan's row has to say what it covered.

ALTER TABLE "sync_job" ADD COLUMN "summary" TEXT;
