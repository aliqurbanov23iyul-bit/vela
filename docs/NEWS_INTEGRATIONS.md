# VELA news integrations

VELA reads only publisher-provided RSS metadata; it does not scrape article pages or copy full text. Each tenant gets the same enabled official feeds: Federal Reserve monetary policy and speeches; ECB press releases/speeches; BLS CPI, PPI, Employment Situation and JOLTS. New tenant rows are seeded by the database trigger in migration 016.

## Feed URLs

The URLs below are linked directly from the publishers' RSS catalogues:

- Federal Reserve: `https://www.federalreserve.gov/feeds/press_monetary.xml` and `https://www.federalreserve.gov/feeds/speeches.xml`
- ECB: `https://www.ecb.europa.eu/rss/press.html`
- BLS: `https://www.bls.gov/feed/cpi.rss`, `ppi.rss`, `empsit.rss`, `jolts.rss`

Official catalogues: [Federal Reserve RSS](https://www.federalreserve.gov/feeds/feeds.htm), [ECB RSS](https://www.ecb.europa.eu/home/html/rss.en.html), [BLS RSS](https://www.bls.gov/feed/). Publisher catalogues link these endpoints. The RSS response is parsed at runtime, but local network restrictions prevented fetching and validating real feed bodies in this environment. The dashboard must show READY only after a successful deployment cron fetch. Unsupported/changed feeds show ERROR and retain a bounded backoff.

RSS availability is not a blanket commercial republication license. VELA stores source IDs, headline, short feed summary, dates, and source link; it does not fetch article pages or forward full text. Verify publisher terms for your intended commercial use before selling access. Reuters/LSEG and Bloomberg are deliberately not integrated without a licensed feed/API.

## Polling

`/api/cron/news` is authenticated with `CRON_SECRET`. The included GitHub Actions schedule calls it every five minutes without requiring a continuously running browser or Windows PC. GitHub scheduled runs can be delayed and only run from the repository's default branch. To enable it, configure repository variable `VELA_PRODUCTION_URL=https://velatradingbot.vercel.app` and repository secret `CRON_SECRET` with the same random value as the Vercel environment variable, then merge this workflow into the default branch. Never put the secret in a variable or commit it. Hobby Vercel Cron can run only once daily, so this uses the free GitHub scheduled runner instead of claiming an unsupported 5-minute Vercel schedule.

The source poller uses 300-second intervals, ETag/Last-Modified validators, bounded timeouts/retry, exponential per-feed backoff (up to one hour), and records last check/success separately from publisher time. On first sync, the current RSS window is stored as backfill; it does not create AI jobs or Telegram alerts. Later new items are analyzed once per changed content hash. Identical URL events are grouped across feeds; the number of feeds is not represented as independent confirmation.

## AI and Telegram

AI uses the already-configured provider/model order and existing API keys. Feed intake continues when no AI key/model is configured; the panel reports that analysis is unavailable. Analysis is a news-based scenario, not a chart/price analysis or a trade instruction. Trading Economics is disabled unless a licensed API client key and secret are configured; no paid service is activated here.

Telegram pairing is user-initiated and expires after five minutes. No first message is sent before Telegram Start. Alert sending is off until the user explicitly enables it on the Telegram panel. Pending delivery records are tenant-scoped, rate-limited, and deduplicated by outlook version. 429 responses honor `retry_after`; uncertain network timeouts are marked UNKNOWN to avoid blind duplicate sends. No live Telegram delivery can be confirmed until valid bot credentials, a configured webhook, a paired user, and a successful scheduled run are all present.

## Operational check

After deploy, check the Xəbərlər panel for each source's last checked/success time. The authenticated cron response includes per-source status codes and counts. Do not infer live feed connectivity from the adapter being installed or from local parser tests. AI provider responses and Telegram delivery status should likewise be verified independently in the deployed environment.

