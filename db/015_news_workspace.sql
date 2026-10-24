-- Product-scope change: stop issuing new execution credentials while preserving
-- broker history and every open position. Never write to broker positions here.
UPDATE accounts SET stopped=true,live_enabled=false,mode='WATCH',
 permission_version=permission_version+1,agent_token_hash=NULL;
UPDATE demo_control SET enabled=false
 WHERE enabled;
UPDATE orders SET state='BLOCKED'
 WHERE state IN ('CREATED','RESERVED');
UPDATE approvals SET consumed_at=COALESCE(consumed_at,now()),decision='REJECTED'
 WHERE consumed_at IS NULL;
UPDATE public_news_feeds SET status='WAITING',items='[]'::jsonb,error_code=NULL,
 lease_token=NULL,lease_until=NULL,next_check_at=now();

CREATE TABLE news_sources(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,
 adapter_key text NOT NULL,name text NOT NULL,enabled boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'WAITING' CHECK(status IN('WAITING','READY','ERROR','PAUSED')),
 config jsonb NOT NULL DEFAULT '{}',polling_interval_seconds integer NOT NULL DEFAULT 300
   CHECK(polling_interval_seconds BETWEEN 60 AND 86400),
 last_checked_at timestamptz,last_success_at timestamptz,error_code text,
 cursor text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,adapter_key)
);
CREATE TABLE news_ingestion_state(
 tenant_id uuid PRIMARY KEY REFERENCES tenants,last_poll_at timestamptz,
 last_success_at timestamptz,last_error_code text,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_events(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,
 dedupe_key text NOT NULL,title_key text NOT NULL,first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),article_count integer NOT NULL DEFAULT 0,
 UNIQUE(tenant_id,dedupe_key)
);
CREATE TABLE news_articles(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,
 source_id uuid NOT NULL REFERENCES news_sources(id),event_id uuid NOT NULL REFERENCES news_events(id),
 external_id text NOT NULL,url text,title text NOT NULL,excerpt text NOT NULL DEFAULT '',
 content_hash text NOT NULL,published_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_id,external_id)
);
CREATE TABLE market_outlooks(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,event_id uuid NOT NULL REFERENCES news_events(id),
 symbol text NOT NULL,action text NOT NULL CHECK(action IN('BUY','SELL','WAIT')),
 horizon_minutes integer NOT NULL CHECK(horizon_minutes BETWEEN 1 AND 10080),
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='array'),interpretation text NOT NULL,
 scenario text NOT NULL,risk_factors jsonb NOT NULL CHECK(jsonb_typeof(risk_factors)='array'),
 contrary_evidence jsonb NOT NULL CHECK(jsonb_typeof(contrary_evidence)='array'),
 invalidation text NOT NULL,source_article_ids jsonb NOT NULL CHECK(jsonb_typeof(source_article_ids)='array'),
 status text NOT NULL CHECK(status IN('CURRENT','UPDATED','INVALIDATED','EXPIRED')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),valid_until timestamptz NOT NULL,
 UNIQUE(event_id,symbol,version)
);
CREATE TABLE news_analysis_jobs(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,event_id uuid NOT NULL REFERENCES news_events,
 evidence_hash text NOT NULL,status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','RUNNING','COMPLETED','FAILED')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,
 last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,event_id,evidence_hash)
);
CREATE TABLE ai_daily_usage(
 tenant_id uuid NOT NULL REFERENCES tenants,usage_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 analyses integer NOT NULL DEFAULT 0 CHECK(analyses>=0),PRIMARY KEY(tenant_id,usage_date)
);
CREATE TABLE telegram_preferences(
 tenant_id uuid NOT NULL REFERENCES tenants,user_id uuid NOT NULL REFERENCES users,
 enabled boolean NOT NULL DEFAULT false,markets text[] NOT NULL DEFAULT '{}',
 muted_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id),
 CHECK(markets <@ ARRAY['EURUSD','GBPUSD','USDCHF','XAUUSD','BTCUSD','ETHUSD']::text[])
);
CREATE TABLE telegram_deliveries(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants,user_id uuid NOT NULL REFERENCES users,
 outlook_id uuid NOT NULL REFERENCES market_outlooks(id),outlook_version integer NOT NULL,
 status text NOT NULL CHECK(status IN('SENDING','SENT','FAILED')),
 sent_at timestamptz,error_code text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,outlook_id,outlook_version)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY[
 'news_sources','news_ingestion_state','news_events','news_articles','market_outlooks',
 'telegram_preferences','telegram_deliveries','news_analysis_jobs','ai_daily_usage'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',t);
END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON news_sources,news_ingestion_state,news_events,news_articles,market_outlooks,telegram_preferences,telegram_deliveries,news_analysis_jobs,ai_daily_usage TO forex_app;
ALTER TABLE news_sources ADD COLUMN lease_until timestamptz;
CREATE OR REPLACE FUNCTION public.claim_news_poll_targets(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,tenant_id uuid,adapter_key text,cursor text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT s.id AS source_id FROM public.news_sources s
  WHERE s.enabled AND (s.lease_until IS NULL OR s.lease_until<now())
    AND (s.last_checked_at IS NULL OR s.last_checked_at+make_interval(secs=>s.polling_interval_seconds)<=now())
  ORDER BY s.last_checked_at NULLS FIRST LIMIT LEAST(GREATEST(p_limit,1),100)
  FOR UPDATE SKIP LOCKED
 )
 UPDATE public.news_sources s SET lease_until=now()+interval '1 minute'
 FROM candidates c WHERE s.id=c.source_id
 RETURNING s.id,s.tenant_id,s.adapter_key,s.cursor;
END $$;
REVOKE ALL ON FUNCTION public.claim_news_poll_targets(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_news_poll_targets(integer) TO forex_app;
CREATE OR REPLACE FUNCTION public.claim_news_analysis_jobs(p_tenant uuid,p_limit integer DEFAULT 5)
RETURNS TABLE(id uuid,event_id uuid,evidence_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_tenant::text IS DISTINCT FROM current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'tenant scope required'; END IF;
 RETURN QUERY
 WITH candidates AS (
  SELECT j.id AS job_id FROM public.news_analysis_jobs j
  WHERE j.tenant_id=p_tenant AND j.attempts<5 AND j.next_attempt_at<=now()
    AND (j.status IN ('QUEUED','FAILED') OR (j.status='RUNNING' AND j.lease_until<now()))
  ORDER BY j.created_at LIMIT LEAST(GREATEST(p_limit,1),20) FOR UPDATE SKIP LOCKED
 )
 UPDATE public.news_analysis_jobs j SET status='RUNNING',attempts=j.attempts+1,
  lease_until=now()+interval '2 minutes',updated_at=now()
 FROM candidates c WHERE j.id=c.job_id RETURNING j.id,j.event_id,j.evidence_hash;
END $$;
REVOKE ALL ON FUNCTION public.claim_news_analysis_jobs(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_news_analysis_jobs(uuid,integer) TO forex_app;

