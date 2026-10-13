-- Invoicing database: row-level security and application-role grants.
--
-- Same three-layer isolation as the platform database (TDD-001 §6.1), applied
-- to invoicing's own tables. The runtime connection is invoicing_app, a
-- NON-owner role; migrations run as the database owner over
-- INVOICING_DIRECT_DATABASE_URL. Both roles are created by
-- `pnpm db:bootstrap`, not here.
--
-- Tenant checks run against `brand`, invoicing's read-only copy of the
-- platform's brands (kept current by platform.brand.* events). The scope
-- itself (merchant, brands) comes from the platform's session resolution and
-- is pushed into this database's transaction by the invoicing Prisma service.

GRANT USAGE ON SCHEMA public TO invoicing_app;

-- ---------------------------------------------------------------------------
-- Scope accessors (identical contract to the platform database's)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_merchant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.merchant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_all_brands() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.all_brands', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_brand_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (
      SELECT array_agg(value::uuid)
      FROM unnest(
        string_to_array(NULLIF(current_setting('app.brand_ids', true), ''), ',')
      ) AS value
    ),
    ARRAY[]::uuid[]
  )
$$;

-- SECURITY DEFINER so the check itself is not filtered by the policy it is
-- being used to evaluate.
CREATE OR REPLACE FUNCTION app_brand_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target IS NOT NULL
     AND app_merchant_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM brand b
       WHERE b.id = target AND b.merchant_id = app_merchant_id()
     )
     AND (app_all_brands() OR target = ANY (app_brand_ids()))
$$;

CREATE OR REPLACE FUNCTION app_invoice_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM invoice i
    WHERE i.id = target AND app_brand_visible(i.brand_id)
  )
$$;

CREATE OR REPLACE FUNCTION app_customer_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM customer c
    WHERE c.id = target AND app_brand_visible(c.brand_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO invoicing_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO invoicing_app;

-- The brand copy belongs to the platform. Invoicing code may read it; only
-- BrandReplicaProjector writes it, on the owner connection.
REVOKE INSERT, UPDATE, DELETE ON brand FROM invoicing_app;

-- Event idempotency bookkeeping: handlers run on the owner connection.
REVOKE ALL ON processed_event FROM invoicing_app;

-- Future tables created by later migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO invoicing_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO invoicing_app;

-- The migration bookkeeping table is not application data.
REVOKE ALL ON "_prisma_migrations" FROM invoicing_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON brand
  USING (
    merchant_id = app_merchant_id()
    AND (app_all_brands() OR id = ANY (app_brand_ids()))
  );

ALTER TABLE brand_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_settings_scope ON brand_settings
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE tax_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_rate_scope ON tax_rate
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_scope ON customer
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE customer_contact_person ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_contact_person_scope ON customer_contact_person
  USING (app_customer_visible(customer_id))
  WITH CHECK (app_customer_visible(customer_id));

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_scope ON invoice
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE line_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY line_item_scope ON line_item
  USING (app_invoice_visible(invoice_id))
  WITH CHECK (app_invoice_visible(invoice_id));

ALTER TABLE invoice_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_event_scope ON invoice_event
  USING (app_invoice_visible(invoice_id))
  WITH CHECK (app_invoice_visible(invoice_id));

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_scope ON payment
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE check_submission ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_submission_scope ON check_submission
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_job_scope ON sync_job
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE pending_brand_assignment ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_brand_assignment_scope ON pending_brand_assignment
  USING (merchant_id = app_merchant_id())
  WITH CHECK (merchant_id = app_merchant_id());
