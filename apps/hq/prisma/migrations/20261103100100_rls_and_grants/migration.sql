-- HQ database: row-level security and application-role grants.
--
-- Same three-layer isolation as the platform and Sugrpay databases
-- (TDD-001 §6.1). The runtime connection is hq_app, a NON-owner role;
-- migrations run as the database owner over HQ_DIRECT_DATABASE_URL. Both roles
-- are created by `pnpm db:bootstrap`, not here.
--
-- Tenant checks run against `brand`, HQ's read-only copy of the platform's
-- brands (kept current by platform.brand.* events). The scope (company,
-- brands) comes from the platform's session resolution and is pushed into
-- this database's transaction by HqPrismaService.withScope.

GRANT USAGE ON SCHEMA public TO hq_app;

-- ---------------------------------------------------------------------------
-- Scope accessors (identical contract to the platform and Sugrpay databases)
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
-- being used to evaluate. HQ tables keyed by brand use it in their policies.
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hq_app;

-- The brand copy belongs to the platform. HQ code may read it; only
-- BrandReplicaProjector writes it, on the owner connection.
REVOKE INSERT, UPDATE, DELETE ON brand FROM hq_app;

-- Event idempotency bookkeeping: handlers run on the owner connection.
REVOKE ALL ON processed_event FROM hq_app;

-- Future tables created by later migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hq_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON brand
  USING (
    merchant_id = app_merchant_id()
    AND (app_all_brands() OR id = ANY (app_brand_ids()))
  );
