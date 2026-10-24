-- Real RSS metadata intake, conservative first-sync suppression and reliable status.
ALTER TABLE news_sources
  ADD COLUMN IF NOT EXISTS etag text,
  ADD COLUMN IF NOT EXISTS last_modified text,
  ADD COLUMN IF NOT EXISTS backoff_seconds integer NOT NULL DEFAULT 0 CHECK(backoff_seconds BETWEEN 0 AND 86400),
  ADD COLUMN IF NOT EXISTS initial_sync_completed boolean NOT NULL DEFAULT false;
ALTER TABLE news_articles
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_item_id text,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS currencies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notify_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'RECEIVED'
    CHECK(processing_status IN('RECEIVED','BACKFILL','QUEUED','ANALYZED','FAILED','NOT_RELEVANT'));
ALTER TABLE telegram_preferences
  ADD COLUMN IF NOT EXISTS important_news boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS market_outlooks boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_digest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hourly_limit integer NOT NULL DEFAULT 4 CHECK(hourly_limit BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
ALTER TABLE telegram_deliveries
  DROP CONSTRAINT IF EXISTS telegram_deliveries_status_check;
ALTER TABLE telegram_deliveries
  ADD CONSTRAINT telegram_deliveries_status_check CHECK(status IN('QUEUED','SENDING','SENT','FAILED','RETRY','UNKNOWN')),
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS chat_id text,
  ADD COLUMN IF NOT EXISTS message_text text;
CREATE INDEX IF NOT EXISTS telegram_deliveries_retry_idx ON telegram_deliveries(status,retry_at) WHERE status IN('QUEUED','RETRY');

CREATE OR REPLACE FUNCTION public.seed_default_news_sources()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.news_sources(id,tenant_id,adapter_key,name,enabled,status,config,polling_interval_seconds)
 VALUES
  (gen_random_uuid(),NEW.id,'fed_monetary','Federal Reserve · Pul siyasəti',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'fed_speeches','Federal Reserve · Çıxışlar',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'ecb_press','ECB · Açıqlamalar və çıxışlar',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'bls_cpi','BLS · CPI',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'bls_ppi','BLS · PPI',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'bls_empsit','BLS · Məşğulluq',true,'WAITING','{}',300),
  (gen_random_uuid(),NEW.id,'bls_jolts','BLS · JOLTS',true,'WAITING','{}',300)
 ON CONFLICT(tenant_id,adapter_key) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seed_news_sources_after_tenant ON tenants;
CREATE TRIGGER seed_news_sources_after_tenant AFTER INSERT ON tenants
 FOR EACH ROW EXECUTE FUNCTION public.seed_default_news_sources();
INSERT INTO news_sources(id,tenant_id,adapter_key,name,enabled,status,config,polling_interval_seconds)
SELECT gen_random_uuid(),t.id,v.key,v.name,true,'WAITING','{}',300
FROM tenants t CROSS JOIN (VALUES
 ('fed_monetary','Federal Reserve · Pul siyasəti'),('fed_speeches','Federal Reserve · Çıxışlar'),
 ('ecb_press','ECB · Açıqlamalar və çıxışlar'),('bls_cpi','BLS · CPI'),('bls_ppi','BLS · PPI'),
 ('bls_empsit','BLS · Məşğulluq'),('bls_jolts','BLS · JOLTS')
) AS v(key,name) ON CONFLICT(tenant_id,adapter_key) DO NOTHING;

DROP FUNCTION public.claim_news_poll_targets(integer);
CREATE FUNCTION public.claim_news_poll_targets(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,tenant_id uuid,adapter_key text,cursor text,etag text,last_modified text,initial_sync_completed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT s.id AS source_id FROM public.news_sources s
  WHERE s.enabled AND (s.lease_until IS NULL OR s.lease_until<now())
    AND (s.last_checked_at IS NULL OR s.last_checked_at+make_interval(secs=>GREATEST(s.polling_interval_seconds,s.backoff_seconds))<=now())
  ORDER BY s.last_checked_at NULLS FIRST LIMIT LEAST(GREATEST(p_limit,1),100)
  FOR UPDATE SKIP LOCKED
 )
 UPDATE public.news_sources s SET lease_until=now()+interval '2 minutes'
 FROM candidates c WHERE s.id=c.source_id
 RETURNING s.id,s.tenant_id,s.adapter_key,s.cursor,s.etag,s.last_modified,s.initial_sync_completed;
END $$;
REVOKE ALL ON FUNCTION public.claim_news_poll_targets(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_news_poll_targets(integer) TO forex_app;

CREATE OR REPLACE FUNCTION public.resolve_telegram_chat(p_chat text)
RETURNS TABLE(tenant_id uuid,user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT l.tenant_id,l.user_id FROM public.telegram_links l
 JOIN public.users u ON u.id=l.user_id AND NOT u.disabled
 JOIN public.tenants t ON t.id=l.tenant_id AND NOT t.suspended
 WHERE l.telegram_id=p_chat AND l.telegram_id IS NOT NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_telegram_chat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_telegram_chat(text) TO forex_app;

