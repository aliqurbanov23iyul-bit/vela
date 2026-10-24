"""One terminal and DEMO account. Optional explicitly armed virtual-money pilot."""
import os
import argparse
import json
import time
import threading
import ctypes
from concurrent.futures import ThreadPoolExecutor
from market import collect_market, publish_market
from datetime import datetime, timezone
import MetaTrader5 as mt5
import requests

def required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value

def acquire_agent_mutex():
    if os.name!='nt':return None
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p]
    kernel.CreateMutexW.restype=ctypes.c_void_p
    handle=kernel.CreateMutexW(None,False,'Local\\VELAConnectorAgentV1')
    if not handle:raise RuntimeError('Agent instance check failed')
    if ctypes.get_last_error()==183:
        kernel.CloseHandle.argtypes=[ctypes.c_void_p];kernel.CloseHandle(handle)
        raise RuntimeError('Agent already running')
    return handle

def write_runtime_status(root,event,details=None):
    from datetime import datetime,timezone
    root=os.path.abspath(root);os.makedirs(root,exist_ok=True)
    value={'event':event,'pid':os.getpid(),'at':datetime.now(timezone.utc).isoformat()}
    if details:value.update(details)
    temp=os.path.join(root,'agent-process-status.tmp')
    with open(temp,'w',encoding='utf-8') as stream:json.dump(value,stream)
    os.replace(temp,os.path.join(root,'agent-process-status.json'))

def run(stop_event=None, on_snapshot=None, demo_pilot=None):
    path = required("MT5_TERMINAL_PATH")
    login = int(required("MT5_LOGIN"))
    server = required("MT5_SERVER")
    origin = required("APP_ORIGIN")
    if not origin.startswith("https://") and not origin.startswith("http://localhost:"):
        raise RuntimeError("HTTPS required")
    # Use an already logged-in dedicated terminal. Password never crosses this bridge.
    if not mt5.initialize(path):
        raise RuntimeError("Terminal initialization failed")
    market_pool = ThreadPoolExecutor(max_workers=2)
    market_jobs = {}
    market_packets = {}
    observations = {}
    next_market = 0
    next_history = 0
    history_status = "ERROR"
    try:
        while stop_event is None or not stop_event.is_set():
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
            for symbol,job in list(market_jobs.items()):
                if job.done():
                    try:
                        result=job.result()
                        if result:observations[symbol]=(market_packets[symbol],result)
                    except Exception:
                        pass
            if demo_pilot is not None:
                payload['connectorVersion']='1.4.3'
                payload['demoProtocol']=2
                payload['demoPilot']=dict(demo_pilot.status)
                if time.monotonic()>=next_history:
                    from demo_bridge import collect_deals
                    next_history=time.monotonic()+60
                    try:
                        payload['deals']=demo_pilot.collect_history()
                        history_status='READY'
                    except Exception:history_status='ERROR'
                payload['historyStatus']=history_status
            response = requests.post(origin + "/api/agent/snapshot", json=payload,
                                     headers={"Authorization": "Bearer " + required("MT5_AGENT_TOKEN")}, timeout=15)
            response.raise_for_status()
            if demo_pilot is not None:
                demo_pilot.step(observations,stop_event,response.json().get('demoControl'))
            print("Snapshot acknowledged; demo pilot status: " + str(demo_pilot.status.get('phase', 'OFF') if demo_pilot is not None else 'DISABLED'), flush=True)
            if on_snapshot is not None:
                on_snapshot()
            if stop_event is not None and stop_event.is_set():
                break
            if time.monotonic() >= next_market:
                next_market = time.monotonic() + 60
                identity = {key: payload[key] for key in ('accountId', 'tenantId', 'login', 'server')}
                for symbol in ('EURUSD', 'XAUUSD'):
                    previous = market_jobs.get(symbol)
                    if previous is not None and not previous.done():
                        continue
                    if previous is not None:
                        try:
                            previous.result()
                        except Exception:
                            print('Market delivery interrupted; will retry with fresh data', flush=True)
                    try:
                        market = collect_market(symbol, int(os.environ.get('MT5_BROKER_UTC_OFFSET_MINUTES', '0')))
                        market_packets[symbol] = market
                        market_jobs[symbol] = market_pool.submit(publish_market, origin, required('MT5_AGENT_TOKEN'), identity, market)
                    except Exception:
                        print('Market ' + symbol + ': candle history not ready; will retry', flush=True)
            if stop_event is None:
                time.sleep(15)
            else:
                stop_event.wait(15)
    finally:
        market_pool.shutdown(wait=stop_event is not None, cancel_futures=True)
        mt5.shutdown()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', help='Private VELA connection JSON file')
    parser.add_argument('--encrypted-config', action='store_true', help='Read the current-user DPAPI protected connection')
    parser.add_argument('--control-dir', help='Local VELA status and cooperative stop directory')
    parser.add_argument('--broker-utc-offset-minutes', type=int, default=None, help='Explicit broker timestamp offset; never inferred from stale data')
    args = parser.parse_args()
    mutex=acquire_agent_mutex()
    config = {}
    if args.config:
        if args.encrypted_config:
            from connector_core import load_config
            config=load_config(args.config)
        else:
            from connector_core import read_config
            config=read_config(args.config)
        names = ('MT5_TERMINAL_PATH', 'MT5_LOGIN', 'MT5_SERVER', 'APP_ORIGIN',
                 'MT5_ACCOUNT_ID', 'MT5_TENANT_ID', 'MT5_AGENT_TOKEN')
        for name in names:
            value = config.get(name)
            if not isinstance(value, str) or not value:
                raise RuntimeError('Invalid connection file')
            os.environ[name] = value
    offset = args.broker_utc_offset_minutes
    if offset is None:
        offset = int(config.get('MT5_BROKER_UTC_OFFSET_MINUTES', '0'))
    if abs(offset) > 840 or offset % 15:
        raise RuntimeError('Invalid broker UTC offset')
    os.environ['MT5_BROKER_UTC_OFFSET_MINUTES'] = str(offset)
    control_dir=args.control_dir or os.environ.get('LOCALAPPDATA',os.path.expanduser('~'))
    stop_event=threading.Event()
    stop_file=os.path.join(control_dir,'stop.request')
    def watch_stop():
        while not stop_event.wait(0.25):
            try:
                if os.path.exists(stop_file):
                    os.remove(stop_file);stop_event.set()
            except OSError:pass
    watcher=threading.Thread(target=watch_stop,name='VELA-stop-watch',daemon=True);watcher.start()
    write_runtime_status(control_dir,'STARTING')
    try:
        def acknowledged():write_runtime_status(control_dir,'CONNECTED')
        from demo_pilot import DemoPilot
        from demo_bridge import DemoApprovalClient
        import MetaTrader5 as mt5_api
        pilot=DemoPilot(control_dir,config,mt5_api,approval_client=DemoApprovalClient(config))
        run(stop_event=stop_event,on_snapshot=acknowledged,demo_pilot=pilot)
        write_runtime_status(control_dir,'STOPPED')
    except Exception as error:
        from connector_core import classify_error
        write_runtime_status(control_dir,'ERROR',{'reason':classify_error(error)})
        raise
