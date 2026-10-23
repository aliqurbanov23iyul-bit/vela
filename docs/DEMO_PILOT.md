# Local virtual-money demo pilot (desktop 1.2.0)

Disabled by default. The desktop Start demo button explicitly arms a two-hour experiment for the saved MT5 login and server. Real/contest accounts and account switching are blocked on every send. This is an unvalidated experimental strategy, not a profitability claim.

Entries need a fresh authenticated server acknowledgement, unchanged permission version, recent validated AI directional observation with separate news assessment, closed M5 and H1 EMA50/200 agreement, M5 RSI (BUY 50–65 / SELL 35–50), and ATR14. Official RSS coverage is partial, not a full economic calendar. AI is sampled at the existing configured cadence/budget; no trade is guaranteed.

Maximum three attempts per session; 30-minute spacing; any existing position or pending order on the account blocks new entries. Session equity loss of 1% disarms new entries. Risk sizing uses MT5 order_calc_profit at the stop, 0.25% equity with 10% cost reserve, broker lot floors (never rounds up), current tick and spread bounds, broker margin/preflight checks, SL at 2 ATR or broker minimum and TP at 3 ATR. Stops do not guarantee a loss cap through gaps/slippage.

An SQLite ledger records each preflight attempt before checking and commits SUBMITTING before the sole order_send. Uncertain sends block further entries across restarts. Same account/symbol/closed-bar/direction cannot be resent, including after rearming. Broker rejects also consume attempts. No retry of an ambiguous order.

Server /api/stop changes permission_version: the next acknowledged desktop snapshot disarms the pilot (normally ~15 seconds; cannot undo an already sent order). Disconnects prevent new entries. Desktop Stop demo or Quit disarms. Expiry stops NEW entries only; existing positions stay open with their broker SL/TP. MT5 and the computer must remain on for further analysis. Server live execution remains disabled.

Status is in the desktop and authenticated dashboard. Equity change is the whole account difference since arming, including other positions, not strategy-attributed profit. Closed trade history is not yet integrated.

Tests: python -m unittest discover -s agent -p "test_*.py" -v (broker calls mocked), npm test, npm run typecheck. Frozen self-test never reads user config, initializes MT5 or sends trades.
