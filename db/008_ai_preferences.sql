CREATE TABLE ai_preferences (
 tenant_id uuid PRIMARY KEY REFERENCES tenants,
 enabled boolean NOT NULL DEFAULT true,
 symbols text[] NOT NULL DEFAULT ARRAY['EURUSD','XAUUSD']::text[] CHECK(cardinality(symbols) BETWEEN 1 AND 2 AND symbols <@ ARRAY['EURUSD','XAUUSD']::text[]),
 interval_minutes integer NOT NULL DEFAULT 30 CHECK(interval_minutes IN (15,30,60)),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON ai_preferences USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON ai_preferences TO forex_app;

CREATE TABLE ai_service_settings (
 id integer PRIMARY KEY CHECK(id=1),provider_order text[],models jsonb NOT NULL DEFAULT '{}',
 min_interval_minutes integer CHECK(min_interval_minutes IN (15,30,60)),
 daily_limit integer CHECK(daily_limit BETWEEN 0 AND 288),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_service_settings(id) VALUES(1);
GRANT SELECT ON ai_service_settings TO forex_app;
CREATE FUNCTION public.vela_save_ai_service(p_session text,p_order text[],p_models jsonb,p_interval integer,p_daily integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; org uuid; k text; v text;
BEGIN
 actor:=public.vela_admin_actor(p_session,true);
 IF p_order IS NULL OR cardinality(p_order) NOT BETWEEN 1 AND 3 OR array_position(p_order,NULL) IS NOT NULL
    OR NOT p_order <@ ARRAY['GEMINI','GROQ','OPENROUTER']::text[]
    OR (SELECT count(DISTINCT x) FROM unnest(p_order) x)<>cardinality(p_order)
    OR p_interval IS NULL OR p_interval NOT IN(15,30,60) OR p_daily IS NULL OR p_daily NOT BETWEEN 0 AND 288
    OR p_models IS NULL OR jsonb_typeof(p_models)<>'object' THEN RAISE EXCEPTION 'INVALID_AI_SETTINGS' USING ERRCODE='22023'; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each_text(p_models) LOOP
  IF k NOT IN('GEMINI','GROQ','OPENROUTER') OR v IS NULL OR length(v)>128 OR (v<>'' AND v !~ '^[a-zA-Z0-9_.:/@+\-]+$')
    OR jsonb_typeof(p_models->k)<>'string' THEN RAISE EXCEPTION 'INVALID_AI_SETTINGS' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE public.ai_service_settings SET provider_order=p_order,models=p_models,min_interval_minutes=p_interval,daily_limit=p_daily,updated_at=now() WHERE id=1;
 SELECT tenant_id INTO org FROM public.sessions WHERE token_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex');
 PERFORM set_config('app.tenant_id',org::text,true);
 INSERT INTO public.audit(tenant_id,actor_id,event,data) VALUES(org,actor,'AI_SERVICE_UPDATED',jsonb_build_object('providers',p_order,'interval',p_interval,'dailyLimit',p_daily));
END $$;
REVOKE ALL ON FUNCTION public.vela_save_ai_service(text,text[],jsonb,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vela_save_ai_service(text,text[],jsonb,integer,integer) TO forex_app;
