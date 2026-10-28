-- Company onboarding (docs/product/stories/company-onboarding.md).
--
-- Register Your Company collects a Company Name that must be unique across
-- every company. company_name_key is that name lower-cased with single spaces,
-- under a unique index, so "Acme Ltd" and "acme  ltd" cannot both register,
-- even at the same moment. registered_at marks the step done; it can be done
-- only once per company.

ALTER TABLE "merchant" ADD COLUMN "company_name" TEXT;
ALTER TABLE "merchant" ADD COLUMN "company_name_key" TEXT;
ALTER TABLE "merchant" ADD COLUMN "registered_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "merchant_company_name_key_key" ON "merchant"("company_name_key");

-- Companies that finished the old onboarding stay finished: they count as
-- registered (they have no Company Name yet, which the unique index allows).
UPDATE "merchant" SET "registered_at" = "created_at" WHERE "onboarding_complete" = true;
