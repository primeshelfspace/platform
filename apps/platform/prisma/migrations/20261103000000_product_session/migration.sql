-- Product Session (docs/product/stories/product-session.md).
--
-- A product session is a `session` row with `product` set: created when a user
-- continues into a product, it holds the refresh token's digest and lasts as
-- long as the refresh token. The product's 12-hour JWT names this row (`sid`),
-- so the platform can resolve it like any session. A row with `product` set is
-- never accepted as a bearer token itself: its raw token is a refresh token.

ALTER TABLE session ADD COLUMN product "Product";

-- ---------------------------------------------------------------------------
-- Resolution: by session id (product JWT) and by token digest (as before).
-- Same columns as before, plus the session's product.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_resolve_session(text);

CREATE FUNCTION app_resolve_session_by_id(p_session_id uuid)
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
  location_ids  uuid[],
  product       text
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
    ),
    s.product::text
  FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE s.id = p_session_id
$$;

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
  location_ids  uuid[],
  product       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.*
  FROM session s
  CROSS JOIN LATERAL app_resolve_session_by_id(s.id) r
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION app_resolve_session_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_session_by_id(uuid) TO platform_app;
REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_session(text) TO platform_app;
