"""Read-only market collection. All terminal reads stay on the main agent thread."""
from datetime import datetime, timezone
import MetaTrader5 as mt5
import requests

def collect_market(base, broker_utc_offset_minutes=0):
    symbol = base
    if mt5.symbol_info(symbol) is None:
        matches = mt5.symbols_get(group=base + '*')
        if not matches:
            raise RuntimeError('Symbol unavailable')
        symbol = sorted(matches, key=lambda item: len(item.name))[0].name
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError('Market watch selection failed')
    info, tick = mt5.symbol_info(symbol), mt5.symbol_info_tick(symbol)
    if info is None or tick is None or tick.bid <= 0 or tick.ask <= 0 or tick.time <= 0:
        raise RuntimeError('Quote unavailable')
    # Some terminals expose broker wall-clock epochs. Use an explicit configured
    # offset, never shift a quote to "now" (which would hide a stale feed).
    offset_ms = broker_utc_offset_minutes * 60000
    frames = {}
    for name, timeframe in [('m5', mt5.TIMEFRAME_M5), ('h1', mt5.TIMEFRAME_H1)]:
        rates = mt5.copy_rates_from_pos(symbol, timeframe, 1, 260)
        if rates is None or len(rates) < 220:
            raise RuntimeError('Closed candle history is not ready')
        frames[name] = [dict(time=int(b['time']) * 1000 - offset_ms, open=float(b['open']),
                             high=float(b['high']), low=float(b['low']), close=float(b['close'])) for b in rates]
    return dict(symbol=base, brokerSymbol=symbol, bid=float(tick.bid), ask=float(tick.ask),
                point=float(info.point), brokerTimeOffsetMinutes=broker_utc_offset_minutes,
                quoteAt=datetime.fromtimestamp(((tick.time_msc or tick.time * 1000) - offset_ms) / 1000, timezone.utc).isoformat().replace('+00:00', 'Z'),
                observedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), **frames)

def publish_market(origin, token, identity, snapshot):
    response = requests.post(origin + '/api/agent/market', json=dict(**identity, **snapshot),
                             headers={'Authorization': 'Bearer ' + token}, timeout=70)
    if not response.ok:
        print('Market upload not accepted (' + str(response.status_code) + '); no trade sent', flush=True)
        return
    data = response.json()
    print('Market ' + snapshot['symbol'] + ': ' + str(data.get('analysis', 'UNKNOWN')) +
          '; provider=' + str(data.get('provider') or 'none') +
          '; data=' + ','.join(data.get('dataIssues', [])) + '; execution disabled', flush=True)
    for failure in data.get('failures', []):
        print('Provider ' + str(failure.get('provider')) + ': ' + str(failure.get('reason')), flush=True)
    return data
