-- Row-level security and application-role grants.
--
-- Layer three of the three isolation layers (TDD-001 §6.1). The request guard
-- and repository scoping come first; this is the backstop that makes a
-- forgotten predicate return nothing instead of someone else's data.
--
-- It only works because the runtime connection uses a NON-owner role: a table
-- owner bypasses RLS entirely. DATABASE_URL is sugrpay_app; migrations run as
-- the owner over DIRECT_DATABASE_URL.

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sugrpay_app') THEN
    CREATE ROLE sugrpay_app LOGIN PASSWORD 'sugrpay_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sugrpay_app;

-- ---------------------------------------------------------------------------
-- Scope accessors
--
-- These read the settings PrismaService pushes into the transaction with
-- set_config(..., is_local => true). is_local matters: it scopes the setting to
-- the transaction, so a pooled connection cannot carry one request's scope into
-- the next.
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
-- being used to evaluate. It reads nothing the caller could not already infer
-- from its own scope.
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

-- ---------------------------------------------------------------------------
-- Session resolution
--
-- The scope is derived FROM the session, so this one lookup cannot itself be
-- scoped. Rather than leave the user table unprotected, the auth path goes
-- through this narrow definer function: one row, selected by a 256-bit token
-- digest, returning only what the guard needs to build a scope.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_resolve_session(p_token_hash text)
RETURNS TABLE (
  session_id  uuid,
  user_id     uuid,
  merchant_id uuid,
  role        "Role",
  status      "UserStatus",
  expires_at  timestamp(3) without time zone,
  revoked_at  timestamp(3) without time zone,
  brand_ids   uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id,
    u.id,
    u.merchant_id,
    u.role,
    u.status,
    s.expires_at,
    s.revoked_at,
    COALESCE(
      (SELECT array_agg(a.brand_id) FROM user_brand_assignment a WHERE a.user_id = u.id),
      ARRAY[]::uuid[]
    )
  FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_session(text) TO sugrpay_app;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sugrpay_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sugrpay_app;

-- Append-only: no UPDATE or DELETE grant is issued on the audit log, so the
-- guarantee holds even if application code is wrong (TDD-001 §5.2).
REVOKE UPDATE, DELETE ON audit_log FROM sugrpay_app;

-- Future tables created by later migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sugrpay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sugrpay_app;

-- The migration bookkeeping table is not application data.
REVOKE ALL ON "_prisma_migrations" FROM sugrpay_app;

-- ---------------------------------------------------------------------------
-- Policies
--
-- `session` is deliberately excluded: it holds no tenant business data, every
-- row is reachable only by a 256-bit token digest, and it is the table the
-- scope is derived from. Everything else is covered.
-- ---------------------------------------------------------------------------

ALTER TABLE merchant ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_scope ON merchant
  USING (id = app_merchant_id())
  WITH CHECK (id = app_merchant_id());

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_scope ON "user"
  USING (merchant_id = app_merchant_id())
  WITH CHECK (merchant_id = app_merchant_id());

ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON brand
  USING (
    merchant_id = app_merchant_id()
    AND (app_all_brands() OR id = ANY (app_brand_ids()))
  )
  WITH CHECK (
    merchant_id = app_merchant_id()
    AND (app_all_brands() OR id = ANY (app_brand_ids()))
  );

ALTER TABLE user_brand_assignment ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_brand_assignment_scope ON user_brand_assignment
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

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

ALTER TABLE integration_connection ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_connection_scope ON integration_connection
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_job_scope ON sync_job
  USING (app_brand_visible(brand_id))
  WITH CHECK (app_brand_visible(brand_id));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_scope ON audit_log
  USING (
    merchant_id = app_merchant_id()
    AND (brand_id IS NULL OR app_brand_visible(brand_id))
  )
  WITH CHECK (merchant_id = app_merchant_id());
