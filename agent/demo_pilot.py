"""Opt-in, time-limited virtual-money MT5 DEMO experiment. Never a live executor."""
import json
import math
from contextlib import contextmanager
import sqlite3
import time
import threading
import os
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path
from uuid import uuid4, UUID

SETTINGS_LOCK = threading.RLock()

def write_settings(path, settings):
    temporary=path.with_suffix(".tmp")
    temporary.write_text(json.dumps(settings),encoding="utf-8")
    for attempt in range(5):
        try:
            os.replace(temporary,path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(.05 * (attempt + 1))

MAGIC = 2601023
REASONS = {
 'APPROVAL':'Telegramda təsdiqin gözlənilir. Təsdiqsiz giriş yoxdur.', 'DECLINED':'Təklif rədd edildi və ya vaxtı bitdi. Əmr göndərilmir.',
 'OFF':'Demo sınağı aktiv deyil.', 'EXPIRED':'Seçilmiş müddət bitdi. Yeni girişlər dayandırılıb.',
 'REAL_BLOCKED':'Uyğun demo hesabı yoxdur. Əməliyyat bloklandı.',
 'ALGO_OFF':'MT5-də Algo Trading və xarici Python ticarət icazəsini aktivləşdir.',
 'LOSS_LIMIT':'Sessiya üzrə 1% equity itkisi həddi. Yeni girişlər dayandırıldı.',
 'POSITION_EXISTS':'Açıq mövqe və ya gözləyən əmr var. Yeni mövqe açılmır.',
 'LIMIT':'Seçilmiş əməliyyat sayı tamamlandı. Yenidən başlatmaq üçün saytdan Başlat seç.', 'LIMIT_WAIT':'Seçilmiş sayda mövqe açılıb. Son bağlanmanın təsdiqi gözlənilir.', 'COOLDOWN':'Seçilmiş giriş tezliyinə görə fasilə gözlənilir.',
 'WAITING':'Təzə AI yönü və uyğun EMA/RSI siqnalı gözlənilir.',
 'UNKNOWN':'Əmrin nəticəsi qeyri-müəyyəndir. Yeni girişlər bloklandı; MT5 tarixçəsini yoxla.',
 'FILLED':'Demo əməliyyatı broker tərəfindən təsdiqləndi. SL və TP göndərilib.',
 'REJECTED':'Broker əmri qəbul etmədi. Eyni siqnal təkrar göndərilmir.',
 'DATA':'Güncəl qiymət, tam məlumat və uyğun spred gözlənilir.',
 'ERROR':'Demo yoxlaması tamamlanmadı; yeni giriş yoxdur.',
}


def arm(root, config, now=None):
    now = time.time() if now is None else now
    settings = dict(enabled=True, sessionId=str(uuid4()), login=config['MT5_LOGIN'],
                    server=config['MT5_SERVER'], startedAt=now, expiresAt=now+7200,
                    startingEquity=None)
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    with SETTINGS_LOCK:write_settings(root/'demo-pilot.json',settings)
    return settings


def disarm(root):
    path = Path(root)/'demo-pilot.json'
    try:
        with SETTINGS_LOCK:
            settings=json.loads(path.read_text(encoding='utf-8'))
            settings['enabled']=False
            write_settings(path,settings)
    except (OSError,ValueError):
        pass


def ema(values, period):
    value=sum(values[:period])/period
    for price in values[period:]: value += 2/(period+1)*(price-value)
    return value


def technical_signal(packet, now):
    frames=[]
    for name,interval in [('m5',300),('h1',3600)]:
        bars=packet.get(name,[])
        if len(bars)<220 or len(bars)>400: return None
        if any(not all(isinstance(b.get(k),(int,float)) and math.isfinite(b[k]) and b[k]>0 for k in ('open','close','high','low','time')) or b['high']<max(b['open'],b['close']) or b['low']>min(b['open'],b['close']) for b in bars):return None
        prices=[b['close'] for b in bars]
        if not all(isinstance(p,(int,float)) and math.isfinite(p) and p>0 for p in prices): return None
        times=[b['time']/1000 for b in bars]
        if any(b<=a for a,b in zip(times,times[1:])) or not interval<=now-times[-1]<=2*interval+20: return None
        frames.append((ema(prices,50),ema(prices,200)))
    bars=packet['m5'];changes=[b['close']-a['close'] for a,b in zip(bars,bars[1:])]
    gain=sum(max(c,0) for c in changes[:14])/14;loss=sum(max(-c,0) for c in changes[:14])/14
    for c in changes[14:]:gain=(gain*13+max(c,0))/14;loss=(loss*13+max(-c,0))/14
    rsi=100 if loss==0 else 100-100/(1+gain/loss)
    ranges=[max(b['high']-b['low'],abs(b['high']-a['close']),abs(b['low']-a['close'])) for a,b in zip(bars,bars[1:])]
    atr=sum(ranges[-14:])/14
    if not math.isfinite(atr) or atr<=0:return None
    direction='BUY' if all(a>b for a,b in frames) and 50<=rsi<=65 else 'SELL' if all(a<b for a,b in frames) and 35<=rsi<=50 else None
    return (direction,atr) if direction else None


def expired(settings,now):
    return settings.get('expiresAt') is not None and now>=settings['expiresAt']


def epoch(value):
    try:return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    except (ValueError,AttributeError,TypeError):return 0


class DemoPilot:
    def __init__(self,root,config,api,clock=time.time,approval_client=None):
        self.root=Path(root);self.config=config;self.api=api;self.clock=clock;self.approval_client=approval_client
        self.root.mkdir(parents=True,exist_ok=True)
        self.ledger=self.root/'demo-orders.sqlite'
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS attempts(k TEXT PRIMARY KEY,account TEXT NOT NULL,session TEXT NOT NULL,at REAL NOT NULL,state TEXT NOT NULL,request TEXT,result TEXT)')
            columns={row[1] for row in db.execute('PRAGMA table_info(attempts)')}
            if 'candidate' not in columns:db.execute('ALTER TABLE attempts ADD COLUMN candidate TEXT')
            if 'reported' not in columns:db.execute('ALTER TABLE attempts ADD COLUMN reported INTEGER NOT NULL DEFAULT 0')
            db.execute('CREATE TABLE IF NOT EXISTS history_positions(account TEXT NOT NULL,position TEXT NOT NULL,session TEXT,PRIMARY KEY(account,position))')
        self.status=dict(enabled=False,phase='OFF',reason=REASONS['OFF'],expiresAt=None,attempts=0,equityChange=0.0,riskPercent=0.25,maxAttempts=None,tradeLimit=None,completedTrades=0,openedTrades=0)

    @contextmanager
    def db(self):
        connection=sqlite3.connect(self.ledger,timeout=5)
        try:
            with connection:yield connection
        finally:connection.close()

    def report(self,phase,**values):
        self.status.update(phase=phase,reason=REASONS[phase],**values)
        (self.root/'demo-pilot-status.json').write_text(json.dumps(self.status),encoding='utf-8')
        return self.status

    def settings(self):
        try:
            with SETTINGS_LOCK:s=json.loads((self.root/'demo-pilot.json').read_text(encoding='utf-8'))
            UUID(s['sessionId'])
            if s.get('enabled') is not True:return None
            if s['login']!=self.config['MT5_LOGIN'] or s['server']!=self.config['MT5_SERVER']:return None
            if s['startedAt']>self.clock()+5:return None
            if s.get('expiresAt') is None:
                if s.get('unlimitedTime') is not True:return None
            elif not 0<s['expiresAt']-s['startedAt']<=86400:return None
            return s
        except (OSError,ValueError,KeyError,TypeError):return None

    def identity(self,account):
        return account is not None and account.trade_mode==self.api.ACCOUNT_TRADE_MODE_DEMO and str(account.login)==self.config['MT5_LOGIN'] and account.server==self.config['MT5_SERVER']

    def step(self,observations,stop_event=None,control=None):
        try:return self._step(observations,stop_event,control)
        except Exception:return self.report('ERROR')

    def collect_history(self):
        from demo_bridge import collect_deals
        account=self.config['MT5_SERVER']+':'+self.config['MT5_LOGIN']
        with self.db() as db:
            sessions={row[0] for row in db.execute('SELECT DISTINCT session FROM attempts WHERE account=?',(account,))}
            positions={row[0]:row[1] for row in db.execute('SELECT position,session FROM history_positions WHERE account=?',(account,))}
        rows=collect_deals(self.api,int(self.config['MT5_BROKER_UTC_OFFSET_MINUTES']),session_ids={'VELA-DEMO-'+s[:8]:s for s in sessions},positions=positions)
        with self.db() as db:
            for position,session in positions.items():db.execute('INSERT INTO history_positions VALUES(?,?,?) ON CONFLICT(account,position) DO UPDATE SET session=COALESCE(excluded.session,history_positions.session)',(account,position,session))
        return rows

    def report_outcomes(self):
        if self.approval_client is None:return
        with self.db() as db:pending=db.execute("SELECT k,candidate,state,result FROM attempts WHERE candidate IS NOT NULL AND reported=0 AND state IN('FILLED','REJECTED','UNKNOWN') ORDER BY at LIMIT 2").fetchall()
        for key,candidate,state,result in pending:
            try:
                answer=self.approval_client.report(candidate,state,json.loads(result or '{}'))
                if answer.get('ok') is True:
                    with self.db() as db:db.execute('UPDATE attempts SET reported=1 WHERE k=?',(key,))
            except Exception:pass

    def sync_remote(self,run,version):
        if not isinstance(run,dict) or run.get('enabled') is not True:
            disarm(self.root);return
        UUID(run['sessionId'])
        start=epoch(run.get('startedAt'));end=epoch(run.get('expiresAt')) if run.get('expiresAt') is not None else None
        limit=run.get('tradeLimit');frequency=run.get('frequency','SIGNAL')
        if run.get('mode') not in ('AUTO','TELEGRAM') or frequency not in ('SIGNAL','HOURLY') or start>self.clock()+5 or (end is not None and (not 0<end-start<=86400 or end<=self.clock())) or (limit is not None and (type(limit) is not int or not 1<=limit<=1000000)):
            disarm(self.root);return
        progress=dict(completedTrades=run.get('completedTrades',0),openedTrades=run.get('openedTrades',0),tradeLimit=limit,frequency=frequency)
        with SETTINGS_LOCK:
            path=self.root/'demo-pilot.json'
            try:previous=json.loads(path.read_text(encoding='utf-8'))
            except (OSError,ValueError):previous={}
            if previous.get('sessionId')==run['sessionId']:
                previous.update(progress);write_settings(path,previous);return
            write_settings(path,dict(enabled=True,sessionId=run['sessionId'],login=self.config['MT5_LOGIN'],server=self.config['MT5_SERVER'],startedAt=start,expiresAt=end,unlimitedTime=end is None,startingEquity=None,permissionVersion=version,mode=run['mode'],**progress))

    def _step(self,observations,stop_event,control):
        now=self.clock()
        if not isinstance(control,dict) or not isinstance(control.get('permissionVersion'),int) or not -5<=now-epoch(control.get('observedAt'))<=45:return self.report('DATA')
        self.report_outcomes()
        run=control.get('run')
        self.sync_remote(run,control['permissionVersion'])
        if isinstance(run,dict) and run.get('enabled') is False and run.get('stopReason') in ('COUNT_LIMIT','TIME_LIMIT'):
            return self.report('LIMIT' if run['stopReason']=='COUNT_LIMIT' else 'EXPIRED',enabled=False,completedTrades=run.get('completedTrades',0),openedTrades=run.get('openedTrades',0),tradeLimit=run.get('tradeLimit'))
        s=self.settings()
        if not s or (stop_event and stop_event.is_set()):return self.report('OFF',enabled=False)
        self.status.update(enabled=True,expiresAt=datetime.fromtimestamp(s['expiresAt'],timezone.utc).isoformat() if s['expiresAt'] is not None else None,tradeLimit=s.get('tradeLimit'),completedTrades=s.get('completedTrades',0),openedTrades=s.get('openedTrades',0))
        if expired(s,now):return self.report('EXPIRED',enabled=False)
        with SETTINGS_LOCK:
            current=self.settings()
            if not current or current['sessionId']!=s['sessionId']:return self.report('OFF',enabled=False)
            if 'permissionVersion' in current and current['permissionVersion']!=control['permissionVersion']:
                disarm(self.root);return self.report('OFF',enabled=False)
            current['permissionVersion']=control['permissionVersion'];write_settings(self.root/'demo-pilot.json',current);s=current
        api=self.api;a=api.account_info();terminal=api.terminal_info()
        if not self.identity(a):return self.report('REAL_BLOCKED')
        if not terminal or not terminal.connected or not getattr(terminal,'trade_allowed',False) or getattr(terminal,'tradeapi_disabled',True) or not getattr(a,'trade_allowed',False) or not getattr(a,'trade_expert',False):return self.report('ALGO_OFF')
        if not math.isfinite(a.equity) or a.equity<=0:return self.report('DATA')
        if s.get('startingEquity') is None:
            with SETTINGS_LOCK:
                current=self.settings()
                if not current or current['sessionId']!=s['sessionId']:return self.report('OFF',enabled=False)
                s=current;s['startingEquity']=a.equity
                write_settings(self.root/'demo-pilot.json',s)
        baseline=s['startingEquity']
        if not isinstance(baseline,(int,float)) or not math.isfinite(baseline) or baseline<=0:return self.report('DATA')
        self.status['equityChange']=round(a.equity-baseline,2)
        if a.equity<=baseline*0.99:
            disarm(self.root)
            if self.approval_client is not None:
                try:self.approval_client.halt(s,'LOSS_LIMIT')
                except Exception:pass
            return self.report('LOSS_LIMIT',enabled=False)
        account=s['server']+':'+s['login']
        with self.db() as db:
            if db.execute("SELECT 1 FROM attempts WHERE account=? AND state IN('SUBMITTING','UNKNOWN')",(account,)).fetchone():return self.report('UNKNOWN')
            attempts,last,filled=db.execute("SELECT count(*),max(at),sum(CASE WHEN state='FILLED' THEN 1 ELSE 0 END) FROM attempts WHERE session=?",(s['sessionId'],)).fetchone()
        self.status['attempts']=attempts
        opened=max(filled or 0,s.get('openedTrades',0));self.status['openedTrades']=opened
        if s.get('tradeLimit') is not None and opened>=s['tradeLimit']:return self.report('LIMIT_WAIT')
        positions=api.positions_get();orders=api.orders_get()
        if positions is None or orders is None:return self.report('DATA')
        if positions or orders:return self.report('POSITION_EXISTS')
        if last is not None and now-last<(3600 if s.get('frequency')=='HOURLY' else 1800):return self.report('COOLDOWN')
        for symbol in ('EURUSD','XAUUSD'):
            entry=observations.get(symbol)
            if not entry:continue
            packet,response=entry
            if response.get('dataIssues')!=[]:continue
            observation=response.get('demoObservation')
            if not isinstance(observation,dict) or observation.get('symbol')!=symbol or observation.get('newsAssessed') is not True:continue
            if not now<epoch(observation.get('expiresAt'))<=now+300:continue
            signal=technical_signal(packet,now)
            if not signal or observation.get('bias')!=signal[0]:continue
            result=self.submit(s,account,packet,signal,stop_event)
            if result:return result
        return self.report('WAITING')

    def submit(self,s,account,packet,signal,stop_event):
        api=self.api;now=self.clock();direction,atr=signal;symbol=packet['brokerSymbol'];base=packet['symbol']
        info=api.symbol_info(symbol);tick=api.symbol_info_tick(symbol);a=api.account_info()
        if not self.identity(a):return self.report('REAL_BLOCKED')
        if not info or not tick or info.trade_mode!=api.SYMBOL_TRADE_MODE_FULL or info.order_mode&49!=49:return None
        quote=(getattr(tick,'time_msc',0) or tick.time*1000)/1000-int(self.config['MT5_BROKER_UTC_OFFSET_MINUTES'])*60
        if not -5<=now-quote<=15 or tick.bid<=0 or tick.ask<tick.bid:return None
        if tick.ask-tick.bid>min(atr*0.25,0.0003 if base=='EURUSD' else 1.0):return None
        step=info.trade_tick_size or info.point
        if not math.isfinite(step) or step<=0:return None
        price=tick.ask if direction=='BUY' else tick.bid
        distance=max(2*atr,(info.trade_stops_level+2)*info.point)
        sl=math.floor((price-distance)/step)*step if direction=='BUY' else math.ceil((price+distance)/step)*step
        tp=math.ceil((price+3*atr)/step)*step if direction=='BUY' else math.floor((price-3*atr)/step)*step
        sl=round(sl,info.digits);tp=round(tp,info.digits)
        if sl<=0 or tp<=0 or (direction=='BUY' and not sl<price<tp) or (direction=='SELL' and not tp<price<sl):return None
        kind=api.ORDER_TYPE_BUY if direction=='BUY' else api.ORDER_TYPE_SELL
        loss=api.order_calc_profit(kind,symbol,1.0,price,sl)
        if loss is None or not math.isfinite(loss) or loss>=0 or info.volume_step<=0:return None
        budget=a.equity*0.0025*0.9 # reserve 10% of planned loss budget for costs
        unit=Decimal(str(info.volume_step));volume=float((Decimal(str(min(budget/abs(loss),info.volume_max)))/unit).to_integral_value(rounding=ROUND_FLOOR)*unit)
        if volume<info.volume_min or volume<=0:return None
        margin=api.order_calc_margin(kind,symbol,volume,price)
        if margin is None or not math.isfinite(margin) or margin<=0 or margin>a.margin_free*0.5:return None
        if info.filling_mode&2:filling=api.ORDER_FILLING_IOC
        elif info.filling_mode&1:filling=api.ORDER_FILLING_FOK
        elif info.trade_exemode!=api.SYMBOL_TRADE_EXECUTION_MARKET:filling=api.ORDER_FILLING_RETURN
        else:return None
        request=dict(action=api.TRADE_ACTION_DEAL,symbol=symbol,volume=volume,type=kind,price=price,sl=sl,tp=tp,
                     deviation=10,magic=MAGIC,comment='VELA-DEMO-'+s['sessionId'][:8],type_time=api.ORDER_TIME_GTC,type_filling=filling)
        if self.approval_client is None:return self.report('APPROVAL')
        approval=self.approval_client.prepare(s,packet,request)
        if approval.get('state')=='COUNT_PENDING':return self.report('LIMIT_WAIT')
        if approval.get('state')=='COOLDOWN':return self.report('COOLDOWN')
        if approval.get('state')=='UNRESOLVED':return self.report('UNKNOWN')
        if approval.get('state')=='PENDING':return self.report('APPROVAL')
        if approval.get('state')!='APPROVED':return self.report('DECLINED')
        if not now<epoch(approval.get('expiresAt'))<=now+300:return self.report('DECLINED')
        approved=approval.get('request')
        if not isinstance(approved,dict) or any(approved.get(k)!=request[k] for k in ('action','symbol','type','deviation','magic','comment','type_time','type_filling')):return self.report('DATA')
        request=approved
        # Recheck the exact values shown in Telegram; never replace an approved
        # volume/SL/TP with a different proposal as prices move.
        tick=api.symbol_info_tick(symbol)
        if tick is None:return self.report('DATA')
        quote=(getattr(tick,'time_msc',0) or tick.time*1000)/1000-int(self.config['MT5_BROKER_UTC_OFFSET_MINUTES'])*60
        current_price=tick.ask if direction=='BUY' else tick.bid
        if not -5<=self.clock()-quote<=15 or abs(current_price-request['price'])>10*info.point or tick.ask-tick.bid>min(atr*0.25,0.0003 if base=='EURUSD' else 1.0):return self.report('DATA')
        if not all(isinstance(request.get(k),(int,float)) and math.isfinite(request[k]) and request[k]>0 for k in ('volume','price','sl','tp')):return self.report('DATA')
        if direction=='BUY' and not request['sl']<current_price<request['tp'] or direction=='SELL' and not request['tp']<current_price<request['sl']:return self.report('DATA')
        if not info.volume_min<=request['volume']<=info.volume_max or abs(request['volume']/info.volume_step-round(request['volume']/info.volume_step))>1e-7:return self.report('DATA')
        a=api.account_info()
        if not self.identity(a):return self.report('REAL_BLOCKED')
        risk=api.order_calc_profit(kind,symbol,request['volume'],current_price,request['sl'])
        margin=api.order_calc_margin(kind,symbol,request['volume'],current_price)
        if risk is None or not math.isfinite(risk) or risk>=0 or abs(risk)>a.equity*.0025*.9 or margin is None or not math.isfinite(margin) or margin<=0 or margin>a.margin_free*.5:return self.report('DATA')
        # Read permissions and identity again immediately before reserving submission.
        current=self.settings()
        if not current or current['sessionId']!=s['sessionId'] or expired(current,self.clock()) or (stop_event and stop_event.is_set()):return self.report('OFF',enabled=False)
        if not self.identity(api.account_info()):return self.report('REAL_BLOCKED')
        if api.positions_get()!=() or api.orders_get()!=():return self.report('POSITION_EXISTS')
        key=account+':'+base+':'+str(packet['m5'][-1]['time'])+':'+direction
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM attempts WHERE k=?',(key,)).fetchone():return None
            if s.get('tradeLimit') is not None and db.execute("SELECT count(*) FROM attempts WHERE session=? AND state='FILLED'",(s['sessionId'],)).fetchone()[0]>=s['tradeLimit']:return self.report('LIMIT_WAIT')
            db.execute("INSERT INTO attempts(k,account,session,at,state,request,result,candidate) VALUES(?,?,?,?,?,?,NULL,?)",(key,account,s['sessionId'],now,'CHECKING',json.dumps(request),approval['id']))
        self.status['attempts']+=1
        try:
            check=api.order_check(request)
        except Exception:check=None
        if check is None or check.retcode!=0:
            with self.db() as db:db.execute("UPDATE attempts SET state='REJECTED' WHERE k=?",(key,))
            return self.report('REJECTED')
        try:grant=self.approval_client.claim(s,approval['id'])
        except Exception:
            with self.db() as db:db.execute("UPDATE attempts SET state='REJECTED' WHERE k=?",(key,))
            return self.report('DECLINED')
        with SETTINGS_LOCK:
            current=self.settings()
            terminal=api.terminal_info()
            a=api.account_info()
            if not current or current['sessionId']!=s['sessionId'] or expired(current,self.clock()) or (stop_event and stop_event.is_set()) or not self.identity(a) or not terminal or not terminal.trade_allowed or terminal.tradeapi_disabled or not a.trade_allowed or not a.trade_expert or api.positions_get()!=() or api.orders_get()!=():
                with self.db() as db:db.execute("UPDATE attempts SET state='REJECTED' WHERE k=?",(key,))
                return self.report('OFF',enabled=False)
            if grant.get('ok') is not True or grant.get('request')!=request or not self.identity(api.account_info()) or (stop_event and stop_event.is_set()) or not self.settings() or expired(s,self.clock()):
                with self.db() as db:db.execute("UPDATE attempts SET state='REJECTED' WHERE k=?",(key,))
                return self.report('DECLINED')
            with self.db() as db:db.execute("UPDATE attempts SET state='SUBMITTING' WHERE k=?",(key,))
        # SUBMITTING is durably committed before the only broker send. Never retry
        # an exception, timeout, PLACED, or uncertain reply, even after restart.
        try:
            result=api.order_send(request)
            if result is not None and result.retcode in (api.TRADE_RETCODE_DONE,api.TRADE_RETCODE_DONE_PARTIAL):state='FILLED'
            elif result is not None and result.retcode in (10004,10006,10007,10013,10014,10015,10016,10017,10018,10019,10020,10021,10027,10030):state='REJECTED'
            else:state='UNKNOWN'
        except Exception:result=None;state='UNKNOWN'
        safe={k:getattr(result,k,None) for k in ('retcode','order','deal','volume','price')}
        with self.db() as db:db.execute('UPDATE attempts SET state=?,result=? WHERE k=?',(state,json.dumps(safe),key))
        self.report_outcomes()
        return self.report(state)
