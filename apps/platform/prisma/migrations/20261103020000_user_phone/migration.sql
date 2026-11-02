-- User Management (docs/product/stories/product-company-apis.md): a user's
-- phone, entered with its country. phone_country is the ISO 3166 alpha-2
-- country it was checked against; phone_number is the number in E.164.
-- Optional here because accounts made before this (and at sign-up) have none.
ALTER TABLE "user" ADD COLUMN phone_country text;
ALTER TABLE "user" ADD COLUMN phone_number text;
