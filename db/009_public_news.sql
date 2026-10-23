-- Only public publisher metadata is shared here. No user/account data or keys.
CREATE TABLE public_news_feeds (
 id text PRIMARY KEY CHECK(id IN('FED','FED_SPEECHES','ECB','BLS_CPI','BLS_JOBS')),
 status text NOT NULL DEFAULT 'WAITING' CHECK(status IN('WAITING','READY','ERROR')),
 checked_at timestamptz,last_success_at timestamptz,error_code text,
 items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(items)='array'),
 next_check_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz
);
INSERT INTO public_news_feeds(id) VALUES('FED'),('FED_SPEECHES'),('ECB'),('BLS_CPI'),('BLS_JOBS');
GRANT SELECT,UPDATE ON public_news_feeds TO forex_app;
