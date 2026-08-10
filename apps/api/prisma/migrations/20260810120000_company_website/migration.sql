-- FR-ONB: the company's registered website, stored as a normalized bare
-- domain (e.g. "acme.com"). Nullable — collected as an optional field on
-- Company Details, and used to verify company_email belongs to the business.
ALTER TABLE "merchant" ADD COLUMN "company_website" TEXT;
