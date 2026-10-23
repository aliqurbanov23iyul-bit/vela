# Website-controlled demo bot — desktop 1.3.0

Only virtual-money DEMO accounts. VELA is the bridge; it does not start trading from its desktop button. On the authenticated website, select AUTO or TELEGRAM and Start (two-hour trial) / Stop. Default selection is TELEGRAM. Start requires an owned DEMO account, recent heartbeat and protocol 1 connector. TELEGRAM additionally requires the owner's linked personal Telegram account and configured bot.

Each run gets a new session and permission version. Stop, tenant emergency stop, Telegram /stop, expiry or a changed version invalidate grants. The connector polls with its account-scoped bearer token on snapshots (~15s normally). A response must be fresh within 45s, tolerating up to 5s server clock skew. Stop prevents new entries, with a possible already-in-flight broker order; it does not close existing positions. MT5, VELA and the computer must remain on.

AUTO: a fresh technically valid candidate gets a one-use server grant without Telegram approval. TELEGRAM: the exact proposed entry, volume, SL and TP go to the linked owner with Accept / Reject. No approval means no trade. Approval is single-use, bound to run/account/permission/request and expires within two minutes or earlier AI expiry. Delayed approval can still be blocked by price drift, risk, stale AI or a stop. No guarantee a proposed trade is executed.

A durable candidate/notification lease limits delivery retries. Telegram delivery can be at-least-once after ambiguous transport failures; duplicate buttons consume the same single approval and cannot duplicate broker execution. No notifications are sent to other tenant owners.

Risk checks: aligned fresh M5/H1 EMA50/200, RSI14, ATR14, separate validated AI news assessment, broker quote/spread, permissions, demo identity, 0.25% planned risk with 10% cost reserve, lot flooring, broker profit/margin/preflight checks, attached SL/TP. One position on the entire account, 30-minute spacing, maximum 3 candidates/session and 3 submission attempts, 1% session equity-loss disarm. Economic calendar and news coverage are incomplete; strategy profitability is unvalidated. Slippage/gaps can exceed planned loss.

SQLite ledger reserves once per account/symbol/closed-bar/direction. Unknown sends block new entries after restart. A server grant is durably consumed before the sole broker send, never retried after uncertain results. A crash after claiming may lose a trade opportunity; it cannot re-use that grant.

Website shows requested run vs connector acknowledgement, candidate decisions and broker-reported deal history. History upload reads last 8 days, up to 200 recent deals for positions identified by VELA magic 2601023, including their manual closures. Website shows last 100 stored deals, with profit+commission+swap+fee per execution (not aggregated position performance). Old positions opened outside this window may be absent. Snapshot refresh ~15s; history refresh ~60s. No fake or forced test orders.

Tests: npm test; npm run typecheck; python -m unittest discover -s agent -p "test_*.py" -v. Broker order and Telegram paths are tested with controlled fixtures, including RLS and one-use approval consumption. Real-money execution remains blocked.
