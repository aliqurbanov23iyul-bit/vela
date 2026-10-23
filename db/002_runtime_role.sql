-- Execute as migration administrator. Supply a unique password separately through psql \password.
CREATE ROLE forex_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE forex TO forex_app;
GRANT USAGE ON SCHEMA public TO forex_app;
GRANT SELECT ON tenants,users,memberships,accounts,proposals,approvals,orders,risk_profiles,telegram_links,audit,system_state TO forex_app;
GRANT SELECT,INSERT,DELETE ON sessions TO forex_app;
GRANT INSERT,UPDATE ON accounts,proposals,approvals,orders,risk_profiles,telegram_links TO forex_app;
GRANT INSERT ON audit TO forex_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO forex_app;
-- No runtime audit mutation grants. No runtime global-stop removal grants.
