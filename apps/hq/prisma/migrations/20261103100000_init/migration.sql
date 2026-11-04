-- HQ database: initial tables. Row-level security and grants are the next
-- migration (rls_and_grants), as in the platform and Sugrpay databases.

CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "theme_color" TEXT NOT NULL,
    "logo_key" TEXT,
    "status" "BrandStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "replicated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_merchant_id_idx" ON "brand"("merchant_id");

CREATE TABLE "processed_event" (
    "event_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("event_id")
);
