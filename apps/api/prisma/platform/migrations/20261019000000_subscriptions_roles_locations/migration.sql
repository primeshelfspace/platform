-- CreateEnum
CREATE TYPE "Product" AS ENUM ('INVOICING', 'HQ');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('STORE', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "product" "Product" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_product_role" (
    "user_id" UUID NOT NULL,
    "product" "Product" NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_product_role_pkey" PRIMARY KEY ("user_id","product")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "brand_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "address" JSONB,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_location_assignment" (
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_assignment_pkey" PRIMARY KEY ("user_id","location_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_merchant_id_product_key" ON "subscription"("merchant_id", "product");

-- CreateIndex
CREATE INDEX "location_merchant_id_idx" ON "location"("merchant_id");

-- CreateIndex
CREATE INDEX "location_brand_id_idx" ON "location"("brand_id");

-- CreateIndex
CREATE INDEX "user_location_assignment_location_id_idx" ON "user_location_assignment"("location_id");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_product_role" ADD CONSTRAINT "user_product_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignment" ADD CONSTRAINT "user_location_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignment" ADD CONSTRAINT "user_location_assignment_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: every existing company keeps invoicing, every existing user keeps
-- the role they already had — now recorded as their invoicing role.
-- ---------------------------------------------------------------------------

INSERT INTO subscription (id, merchant_id, product, status, updated_at)
SELECT gen_random_uuid(), m.id, 'INVOICING', 'ACTIVE', CURRENT_TIMESTAMP
FROM merchant m
ON CONFLICT (merchant_id, product) DO NOTHING;

INSERT INTO user_product_role (user_id, product, role, updated_at)
SELECT u.id, 'INVOICING', u.role::text, CURRENT_TIMESTAMP
FROM "user" u
ON CONFLICT (user_id, product) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Scope accessors for locations (set by the request scope like brand ids)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_all_locations() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.all_locations', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_location_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (
      SELECT array_agg(value::uuid)
      FROM unnest(
        string_to_array(NULLIF(current_setting('app.location_ids', true), ''), ',')
      ) AS value
    ),
    ARRAY[]::uuid[]
  )
$$;

-- A location is visible inside its company when the scope covers every
-- location, when it is assigned to the user, or when it belongs to a brand
-- the user can reach (extended scope).
CREATE OR REPLACE FUNCTION app_location_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target IS NOT NULL
     AND app_merchant_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM location l
       WHERE l.id = target
         AND l.merchant_id = app_merchant_id()
         AND (
           app_all_locations()
           OR l.id = ANY (app_location_ids())
           OR (l.brand_id IS NOT NULL AND (app_all_brands() OR l.brand_id = ANY (app_brand_ids())))
         )
     )
$$;

CREATE OR REPLACE FUNCTION app_user_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target IS NOT NULL
     AND app_merchant_id() IS NOT NULL
     AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = target AND u.merchant_id = app_merchant_id())
$$;

-- ---------------------------------------------------------------------------
-- Session resolution now also returns the company's active products, the
-- user's role per product and their assigned locations.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_resolve_session(text);

CREATE FUNCTION app_resolve_session(p_token_hash text)
RETURNS TABLE (
  session_id    uuid,
  user_id       uuid,
  merchant_id   uuid,
  role          "Role",
  status        "UserStatus",
  expires_at    timestamp(3) without time zone,
  revoked_at    timestamp(3) without time zone,
  brand_ids     uuid[],
  products      text[],
  product_roles jsonb,
  location_ids  uuid[]
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
    ),
    COALESCE(
      (SELECT array_agg(sub.product::text) FROM subscription sub
        WHERE sub.merchant_id = u.merchant_id AND sub.status = 'ACTIVE'),
      ARRAY[]::text[]
    ),
    COALESCE(
      (SELECT jsonb_object_agg(r.product::text, r.role) FROM user_product_role r WHERE r.user_id = u.id),
      '{}'::jsonb
    ),
    COALESCE(
      (SELECT array_agg(la.location_id) FROM user_location_assignment la WHERE la.user_id = u.id),
      ARRAY[]::uuid[]
    )
  FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_session(text) TO platform_app;

-- ---------------------------------------------------------------------------
-- Grants (default privileges already cover new tables; stated for clarity)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription, user_product_role, location, user_location_assignment TO platform_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_scope ON subscription
  USING (merchant_id = app_merchant_id())
  WITH CHECK (merchant_id = app_merchant_id());

ALTER TABLE user_product_role ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_product_role_scope ON user_product_role
  USING (app_user_visible(user_id))
  WITH CHECK (app_user_visible(user_id));

ALTER TABLE location ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_scope ON location
  USING (
    merchant_id = app_merchant_id()
    AND (
      app_all_locations()
      OR id = ANY (app_location_ids())
      OR (brand_id IS NOT NULL AND (app_all_brands() OR brand_id = ANY (app_brand_ids())))
    )
  )
  WITH CHECK (
    merchant_id = app_merchant_id()
    AND (brand_id IS NULL OR app_all_brands() OR brand_id = ANY (app_brand_ids()))
  );

ALTER TABLE user_location_assignment ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_location_assignment_scope ON user_location_assignment
  USING (app_location_visible(location_id))
  WITH CHECK (app_location_visible(location_id));
