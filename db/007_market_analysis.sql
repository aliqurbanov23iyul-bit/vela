CREATE TABLE market_latest (
 tenant_id uuid NOT NULL REFERENCES tenants, account_id uuid NOT NULL REFERENCES accounts,
 symbol text NOT NULL, broker_symbol text NOT NULL, quote_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 summary jsonb NOT NULL, PRIMARY KEY(account_id,symbol)
);
CREATE TABLE market_analysis_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,account_id uuid NOT NULL REFERENCES accounts,
 symbol text NOT NULL,bar_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','NO_PROVIDER','FAILED')),
 result jsonb, UNIQUE(account_id,symbol,bar_at)
);
CREATE INDEX market_runs_latest ON market_analysis_runs(tenant_id,account_id,symbol,created_at DESC);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['market_latest','market_analysis_runs'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',t);
END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON market_latest,market_analysis_runs TO forex_app;
