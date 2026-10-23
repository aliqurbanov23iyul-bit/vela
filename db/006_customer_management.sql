ALTER TABLE users ADD COLUMN display_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE admin_tenant_grants (
  admin_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(admin_id,tenant_id)
);
-- No direct runtime grants: only audited functions below can use this directory.

CREATE FUNCTION public.vela_admin_actor(p_session text,p_recent boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT s.user_id INTO actor FROM public.sessions s
    JOIN public.users u ON u.id=s.user_id JOIN public.tenants t ON t.id=s.tenant_id
    WHERE s.token_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND s.expires_at>now() AND u.super_admin
      AND NOT u.disabled AND NOT t.suspended AND u.mfa_secret IS NOT NULL
      AND s.reauthenticated_at IS NOT NULL;
  IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_recent AND NOT EXISTS(SELECT 1 FROM public.sessions WHERE token_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND reauthenticated_at>now()-interval '15 minutes')
    THEN RAISE EXCEPTION 'REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
  RETURN actor;
END $$;

CREATE FUNCTION public.vela_create_customer(p_session text,p_username text,p_hash text,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; customer uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
BEGIN
  actor:=public.vela_admin_actor(p_session,true);
  IF p_username !~ '^[a-zA-Z0-9_.-]{3,64}$' OR length(p_name)>100 OR p_hash NOT LIKE '$argon2id$%' OR length(p_hash)>512
    THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE='22023'; END IF;
  INSERT INTO public.tenants(id,name) VALUES(org,CASE WHEN p_name='' THEN p_username ELSE p_name END);
  INSERT INTO public.users(id,username,password_hash,default_tenant_id,display_name)
    VALUES(customer,p_username,p_hash,org,p_name);
  PERFORM set_config('app.tenant_id',org::text,true);
  INSERT INTO public.memberships(tenant_id,user_id,role) VALUES(org,customer,'OWNER');
  INSERT INTO public.admin_tenant_grants(admin_id,tenant_id) VALUES(actor,org);
  INSERT INTO public.audit(tenant_id,actor_id,event,data) VALUES(org,actor,'CUSTOMER_CREATED',jsonb_build_object('user_id',customer));
  RETURN customer;
END $$;

CREATE FUNCTION public.vela_list_customers(p_session text,p_search text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; rec record; items jsonb:='[]'; count_all integer; account_count integer;
BEGIN
  actor:=public.vela_admin_actor(p_session,false);
  IF length(p_search)>100 OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'INVALID_FILTER' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO count_all FROM public.admin_tenant_grants g
    JOIN public.users u ON u.default_tenant_id=g.tenant_id
    WHERE g.admin_id=actor AND NOT u.super_admin AND (u.username ILIKE '%'||p_search||'%' OR u.display_name ILIKE '%'||p_search||'%');
  FOR rec IN SELECT u.id,u.username,u.display_name,u.disabled,u.created_at,u.default_tenant_id,t.suspended
    FROM public.admin_tenant_grants g JOIN public.users u ON u.default_tenant_id=g.tenant_id JOIN public.tenants t ON t.id=g.tenant_id
    WHERE g.admin_id=actor AND NOT u.super_admin AND (u.username ILIKE '%'||p_search||'%' OR u.display_name ILIKE '%'||p_search||'%')
    ORDER BY u.created_at DESC,u.id LIMIT 20 OFFSET p_page*20
  LOOP
    PERFORM set_config('app.tenant_id',rec.default_tenant_id::text,true);
    SELECT count(*) INTO account_count FROM public.accounts WHERE tenant_id=rec.default_tenant_id;
    items:=items||jsonb_build_array(jsonb_build_object('id',rec.id,'username',rec.username,'displayName',rec.display_name,
      'disabled',rec.disabled OR rec.suspended,'createdAt',rec.created_at,'accountCount',account_count));
    INSERT INTO public.audit(tenant_id,actor_id,event,data) VALUES(rec.default_tenant_id,actor,'ADMIN_CUSTOMER_LIST_ACCESS',jsonb_build_object('user_id',rec.id));
  END LOOP;
  RETURN jsonb_build_object('customers',items,'total',count_all,'page',p_page);
END $$;

CREATE FUNCTION public.vela_customer_detail(p_session text,p_customer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; rec record; result jsonb; account_rows jsonb;
BEGIN
  actor:=public.vela_admin_actor(p_session,false);
  SELECT u.id,u.username,u.display_name,u.disabled,u.created_at,u.default_tenant_id,t.suspended INTO rec
    FROM public.users u JOIN public.admin_tenant_grants g ON g.tenant_id=u.default_tenant_id
    JOIN public.tenants t ON t.id=g.tenant_id
    WHERE u.id=p_customer AND g.admin_id=actor AND NOT u.super_admin;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.tenant_id',rec.default_tenant_id::text,true);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'mode',a.mode,'stopped',a.stopped,
    'currency',a.currency,'accountType',a.account_type,'brokerLogin',a.broker_login,'server',a.server,
    'heartbeat',a.heartbeat,'reconciledAt',a.reconciled_at,
    'balance',a.snapshot->'balance','equity',a.snapshot->'equity','margin',a.snapshot->'margin','freeMargin',a.snapshot->'freeMargin',
    'positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket',p->'ticket','symbol',p->'symbol','type',p->'type',
       'volume',p->'volume','price_open',p->'price_open','price_current',p->'price_current','sl',p->'sl','tp',p->'tp',
       'profit',p->'profit','swap',p->'swap')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.snapshot->'positions')='array' THEN a.snapshot->'positions' ELSE '[]' END) p),'[]'::jsonb),
    'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket',o->'ticket','symbol',o->'symbol','type',o->'type',
       'volume_current',o->'volume_current','price_open',o->'price_open','sl',o->'sl','tp',o->'tp'))
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.snapshot->'orders')='array' THEN a.snapshot->'orders' ELSE '[]' END) o),'[]'::jsonb)
    ) ORDER BY a.label),'[]'::jsonb) INTO account_rows FROM public.accounts a WHERE a.tenant_id=rec.default_tenant_id;
  result:=jsonb_build_object('id',rec.id,'username',rec.username,'displayName',rec.display_name,'disabled',rec.disabled OR rec.suspended,
    'createdAt',rec.created_at,'accounts',account_rows);
  INSERT INTO public.audit(tenant_id,actor_id,event,data) VALUES(rec.default_tenant_id,actor,'ADMIN_CUSTOMER_PROFILE_ACCESS',jsonb_build_object('user_id',rec.id));
  RETURN result;
END $$;

CREATE FUNCTION public.vela_set_customer_access(p_session text,p_customer uuid,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; org uuid;
BEGIN
  actor:=public.vela_admin_actor(p_session,true);
  SELECT u.default_tenant_id INTO org FROM public.users u JOIN public.admin_tenant_grants g ON g.tenant_id=u.default_tenant_id
    WHERE u.id=p_customer AND g.admin_id=actor AND NOT u.super_admin FOR UPDATE OF u;
  IF org IS NULL THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.tenant_id',org::text,true);
  UPDATE public.users SET disabled=NOT p_enabled WHERE id=p_customer;
  UPDATE public.tenants SET suspended=NOT p_enabled WHERE id=org;
  IF NOT p_enabled THEN
    DELETE FROM public.sessions WHERE user_id=p_customer;
    UPDATE public.accounts SET stopped=true,live_enabled=false,permission_version=permission_version+1 WHERE tenant_id=org;
    UPDATE public.orders SET state='BLOCKED' WHERE tenant_id=org AND state IN ('CREATED','RESERVED');
  END IF;
  INSERT INTO public.audit(tenant_id,actor_id,event,data) VALUES(org,actor,
    CASE WHEN p_enabled THEN 'CUSTOMER_ENABLED' ELSE 'CUSTOMER_SUSPENDED' END,jsonb_build_object('user_id',p_customer));
END $$;

REVOKE ALL ON FUNCTION public.vela_admin_actor(text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vela_create_customer(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vela_list_customers(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vela_customer_detail(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vela_set_customer_access(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vela_create_customer(text,text,text,text),public.vela_list_customers(text,text,integer),
  public.vela_customer_detail(text,uuid),public.vela_set_customer_access(text,uuid,boolean) TO forex_app;
