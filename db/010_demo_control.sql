CREATE TABLE demo_control (
 account_id uuid PRIMARY KEY REFERENCES accounts,tenant_id uuid NOT NULL REFERENCES tenants,
 session_id uuid NOT NULL UNIQUE,enabled boolean NOT NULL DEFAULT false,
 mode text NOT NULL CHECK(mode IN('AUTO','TELEGRAM')),
 started_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 permission_version integer NOT NULL,
 CHECK(expires_at>started_at AND expires_at<=started_at+interval '2 hours')
);
CREATE TABLE demo_candidates (
 id uuid PRIMARY KEY REFERENCES proposals,tenant_id uuid NOT NULL REFERENCES tenants,
 account_id uuid NOT NULL REFERENCES accounts,session_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN('AUTO','TELEGRAM')),
 symbol text NOT NULL CHECK(symbol IN('EURUSD','XAUUSD')),bar_at timestamptz NOT NULL,
 request jsonb NOT NULL,approval_id uuid REFERENCES approvals,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 claimed_at timestamptz,notified_at timestamptz,notification_lease timestamptz,
 delivery_attempts integer NOT NULL DEFAULT 0,
 UNIQUE(session_id,symbol,bar_at)
);
CREATE TABLE demo_deals (
 tenant_id uuid NOT NULL REFERENCES tenants,account_id uuid NOT NULL REFERENCES accounts,
 ticket text NOT NULL,payload jsonb NOT NULL,deal_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,ticket)
);
CREATE INDEX demo_deals_latest ON demo_deals(tenant_id,account_id,deal_at DESC);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['demo_control','demo_candidates','demo_deals'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',t);
END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON demo_control,demo_candidates,demo_deals TO forex_app;
