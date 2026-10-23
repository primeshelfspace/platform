-- Zoho Books connections move from the platform database (integration_connection,
-- provider ZOHO_BOOKS) into Sugrpay's own database: Zoho sync is Sugrpay-only, and
-- after the API split Sugrpay must not reach into the platform's tables.
-- The rows themselves are copied by scripts/db/move-zoho-connections.ts.

CREATE TYPE "ZohoConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'UNHEALTHY', 'REVOKED');

CREATE TABLE "zoho_connection" (
    "brand_id" UUID NOT NULL,
    "status" "ZohoConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "encrypted_credentials" TEXT,
    "config" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "last_pulled_at" TIMESTAMP(3),
    "health" TEXT,
    "pull_frequency_minutes" INTEGER NOT NULL DEFAULT 15,
    "customer_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "invoice_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "zoho_connection_pkey" PRIMARY KEY ("brand_id")
);

ALTER TABLE "zoho_connection" ADD CONSTRAINT "zoho_connection_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same isolation as every brand-owned table: only brands the scope can see.
ALTER TABLE zoho_connection ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_connection_scope ON zoho_connection
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON zoho_connection TO invoicing_app;
