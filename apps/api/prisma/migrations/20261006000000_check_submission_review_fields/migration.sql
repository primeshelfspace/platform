-- AlterTable
-- check_submission already has rows predating these columns (an earlier
-- phase wrote submissions without a check number or amount), so a plain
-- NOT NULL add fails on backfill. Default-then-drop backfills those legacy
-- rows with a placeholder and still requires real values from here on.
ALTER TABLE "check_submission" ADD COLUMN "check_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "check_submission" ADD COLUMN "amount_minor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "check_submission" ALTER COLUMN "check_number" DROP DEFAULT;
ALTER TABLE "check_submission" ALTER COLUMN "amount_minor" DROP DEFAULT;
