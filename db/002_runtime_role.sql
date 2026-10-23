-- Execute as migration administrator. Supply a unique password separately through psql \password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='forex_app') THEN
    CREATE ROLE forex_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='forex_app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'forex_app must not bypass RLS';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO forex_app',current_database());
  IF current_user <> 'forex_app' THEN
    EXECUTE format('GRANT forex_app TO %I',current_user);
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO forex_app;
GRANT SELECT ON tenants,users,memberships,accounts,proposals,approvals,orders,risk_profiles,telegram_links,audit,system_state TO forex_app;
GRANT SELECT,INSERT,DELETE ON sessions TO forex_app;
GRANT INSERT,UPDATE ON accounts,proposals,approvals,orders,risk_profiles,telegram_links TO forex_app;
GRANT INSERT ON audit TO forex_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO forex_app;
-- No runtime audit mutation grants. No runtime global-stop removal grants.
