"""One terminal, account and process. Read-only by construction; never calls order_send."""
import os
import argparse
import json
import time
from datetime import datetime, timezone
import MetaTrader5 as mt5
import requests

def required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value

def run():
    path = required("MT5_TERMINAL_PATH")
    login = int(required("MT5_LOGIN"))
    server = required("MT5_SERVER")
    origin = required("APP_ORIGIN")
    if not origin.startswith("https://") and not origin.startswith("http://localhost:"):
        raise RuntimeError("HTTPS required")
    # Use an already logged-in dedicated terminal. Password never crosses this bridge.
    if not mt5.initialize(path):
        raise RuntimeError("Terminal initialization failed")
    try:
        while True:
            account = mt5.account_info()
            terminal = mt5.terminal_info()
            if account is None or terminal is None or not terminal.connected:
                raise RuntimeError("Terminal disconnected")
            if account.login != login or account.server != server:
                raise RuntimeError("Account identity mismatch; refusing account switching")
            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                raise RuntimeError("This initial connector only supports demo accounts")
            positions, orders = mt5.positions_get(), mt5.orders_get()
            if positions is None or orders is None:
                raise RuntimeError("Broker snapshot incomplete")
            payload = {"accountId": required("MT5_ACCOUNT_ID"), "tenantId": required("MT5_TENANT_ID"),
                       "login": str(login), "server": server, "currency": account.currency,
                       "accountType": {0: "DEMO", 1: "CONTEST", 2: "REAL"}[account.trade_mode],
                       "balance": account.balance, "equity": account.equity, "margin": account.margin,
                       "freeMargin": account.margin_free, "positions": [p._asdict() for p in positions],
                       "orders": [o._asdict() for o in orders],
                       "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
            response = requests.post(origin + "/api/agent/snapshot", json=payload,
                                     headers={"Authorization": "Bearer " + required("MT5_AGENT_TOKEN")}, timeout=15)
            response.raise_for_status()
            print("Snapshot acknowledged; execution disabled", flush=True)
            time.sleep(15)
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', help='Private VELA connection JSON file')
    args = parser.parse_args()
    if args.config:
        with open(args.config, encoding='utf-8-sig') as stream:
            config = json.load(stream)
        names = ('MT5_TERMINAL_PATH', 'MT5_LOGIN', 'MT5_SERVER', 'APP_ORIGIN',
                 'MT5_ACCOUNT_ID', 'MT5_TENANT_ID', 'MT5_AGENT_TOKEN')
        for name in names:
            value = config.get(name)
            if not isinstance(value, str) or not value:
                raise RuntimeError('Invalid connection file')
            os.environ[name] = value
    run()
