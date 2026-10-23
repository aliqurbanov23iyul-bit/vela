ALTER TABLE users ADD COLUMN default_tenant_id uuid REFERENCES tenants(id);
ALTER TABLE users ADD COLUMN mfa_last_counter bigint;
-- Backfill a unique default membership for accounts created with the old CLI.
UPDATE users u SET default_tenant_id=(SELECT m.tenant_id FROM memberships m WHERE m.user_id=u.id LIMIT 1)
WHERE (SELECT count(*) FROM memberships m WHERE m.user_id=u.id)=1;
CREATE TABLE setup_challenges (
  id uuid PRIMARY KEY,
  setup_key_hash text NOT NULL,
  secret_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
-- Challenge material is never granted to the runtime role.
GRANT UPDATE(mfa_last_counter) ON users TO forex_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='forex_app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'forex_app must not bypass RLS';
  END IF;
  IF current_user <> 'forex_app' THEN
    EXECUTE format('GRANT forex_app TO %I',current_user);
  END IF;
END $$;
