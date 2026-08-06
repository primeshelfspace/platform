-- FR-AUTH-005/006 and FR-ONB: the emailed set-password / reset link.
--
-- Only the SHA-256 digest of the token is stored, exactly as `session` does —
-- the raw value lives in the recipient's inbox and nowhere else, so a database
-- disclosure yields no usable links.
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_token_token_hash_key"
    ON "password_reset_token"("token_hash");
CREATE INDEX "password_reset_token_user_id_idx" ON "password_reset_token"("user_id");
CREATE INDEX "password_reset_token_expires_at_idx" ON "password_reset_token"("expires_at");

ALTER TABLE "password_reset_token"
    ADD CONSTRAINT "password_reset_token_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deliberately NOT under row-level security, for the same reason `session` is
-- excluded (see 20260727180200_rls_and_grants): this table is consulted in
-- order to establish who someone is, before any tenant scope exists, so it
-- cannot itself be scoped by that answer. It holds no tenant business data —
-- only a digest, an expiry, and which user it belongs to.
--
-- The ALTER DEFAULT PRIVILEGES in that same migration already grants
-- fenwick_app SELECT/INSERT/UPDATE/DELETE on tables created later, so no
-- explicit GRANT is needed here.
