-- FR-ONB: "doing business as", the trading name where it differs from the
-- legal one. Nullable — most businesses trade under their legal name, and
-- every merchant staged before this column existed has no value for it.
ALTER TABLE "merchant" ADD COLUMN "company_dba" TEXT;
