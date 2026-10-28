-- Which Zoho version of a contact's full detail (addresses, contact persons)
-- has been applied locally. The contact scan now imports from Zoho's list
-- alone and the detail is fetched when the customer is first opened.

ALTER TABLE "customer" ADD COLUMN "zoho_detail_version" TIMESTAMP(3);

-- Every linked contact so far came in through a detail fetch or a push, so its
-- detail is as current as its synced version.
UPDATE "customer"
SET "zoho_detail_version" = "zoho_synced_version"
WHERE "zoho_contact_id" IS NOT NULL;
