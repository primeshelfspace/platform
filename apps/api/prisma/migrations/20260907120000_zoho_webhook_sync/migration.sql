-- FR-ZHO-webhook: real-time Zoho <-> platform sync.
--
-- 1. zoho_unsynced_reason on customer/invoice/payment — set when a required-
--    field check blocks an outbound push, cleared the moment a push succeeds.
-- 2. pending_brand_assignment — a Zoho-native contact/invoice event this
--    platform could not route to exactly one brand automatically.

-- CreateEnum
CREATE TYPE "PendingAssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "PendingAssignmentReason" AS ENUM ('NEW_RECORD_MULTI_BRAND', 'ORPHANED_UPDATE');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN "zoho_unsynced_reason" TEXT;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN "zoho_unsynced_reason" TEXT;

-- AlterTable
ALTER TABLE "payment" ADD COLUMN "zoho_unsynced_reason" TEXT;

-- CreateTable
CREATE TABLE "pending_brand_assignment" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "reason" "PendingAssignmentReason" NOT NULL,
    "status" "PendingAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "assigned_brand_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_brand_assignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_brand_assignment_provider_organization_id_object_t_key"
    ON "pending_brand_assignment"("provider", "organization_id", "object_type", "remote_id");

CREATE INDEX "pending_brand_assignment_merchant_id_status_idx"
    ON "pending_brand_assignment"("merchant_id", "status");

ALTER TABLE "pending_brand_assignment"
    ADD CONSTRAINT "pending_brand_assignment_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_brand_assignment"
    ADD CONSTRAINT "pending_brand_assignment_assigned_brand_id_fkey"
    FOREIGN KEY ("assigned_brand_id") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: merchant-scoped, the same shape merchant_scope itself uses — this
-- table carries no single brand_id (it exists precisely because a brand was
-- not yet known), but every organization_id it references belongs to
-- exactly one merchant in practice, so merchant_id is a real, populated
-- tenant boundary rather than a workaround.
ALTER TABLE "pending_brand_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_brand_assignment_scope" ON "pending_brand_assignment"
  USING (merchant_id = app_merchant_id())
  WITH CHECK (merchant_id = app_merchant_id());

-- No explicit GRANT: covered by the ALTER DEFAULT PRIVILEGES in
-- 20260727180200_rls_and_grants.
