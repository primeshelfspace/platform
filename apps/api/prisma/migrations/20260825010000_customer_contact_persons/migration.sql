-- CreateTable
CREATE TABLE "customer_contact_person" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zoho_contact_person_id" TEXT,
    "salutation" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "skype" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contact_person_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_contact_person_customer_id_idx" ON "customer_contact_person"("customer_id");

-- Same reasoning as customer_brand_id_zoho_contact_id_key: ZohoPullService
-- upserts each contact person on this rather than a naive
-- delete-then-recreate, which is exactly what made line items unsafe under
-- concurrent pulls of the same parent record.
CREATE UNIQUE INDEX "customer_contact_person_customer_id_zoho_contact_person_id_key"
    ON "customer_contact_person"("customer_id", "zoho_contact_person_id");

ALTER TABLE "customer_contact_person"
    ADD CONSTRAINT "customer_contact_person_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: this table carries no brand_id of its own — reached exclusively
-- through its parent customer, the same shape line_item already uses
-- against invoice (app_invoice_visible, in 20260727180200_rls_and_grants).
-- app_customer_visible follows that exact pattern for this new parent.
CREATE OR REPLACE FUNCTION app_customer_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM customer c
    WHERE c.id = target AND app_brand_visible(c.brand_id)
  )
$$;

ALTER TABLE "customer_contact_person" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_contact_person_scope" ON "customer_contact_person"
  USING (app_customer_visible(customer_id))
  WITH CHECK (app_customer_visible(customer_id));

-- No explicit GRANT: the ALTER DEFAULT PRIVILEGES in 20260727180200_rls_and_grants
-- already covers SELECT/INSERT/UPDATE/DELETE on tables created by later
-- migrations (see password_reset_token's migration for the same note).
