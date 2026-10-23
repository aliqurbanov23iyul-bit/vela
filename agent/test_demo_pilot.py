import json
import tempfile
import unittest
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
from demo_pilot import DemoPilot,arm,disarm,technical_signal

class PilotTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'.desktop-build');self.root=Path(self.tmp.name)
  self.now=1800000000.;self.cfg={'MT5_LOGIN':'123','MT5_SERVER':'Demo','MT5_BROKER_UTC_OFFSET_MINUTES':'0'}
  self.api=Mock(ACCOUNT_TRADE_MODE_DEMO=0,SYMBOL_TRADE_MODE_FULL=4,ORDER_TYPE_BUY=0,ORDER_TYPE_SELL=1,ORDER_FILLING_IOC=1,ORDER_FILLING_FOK=0,ORDER_FILLING_RETURN=2,SYMBOL_TRADE_EXECUTION_MARKET=2,TRADE_ACTION_DEAL=1,ORDER_TIME_GTC=0,TRADE_RETCODE_DONE=10009,TRADE_RETCODE_DONE_PARTIAL=10010)
  self.account=NS(login=123,server='Demo',trade_mode=0,equity=10000.,margin_free=10000.,trade_allowed=True,trade_expert=True)
  self.api.account_info.return_value=self.account
  self.api.terminal_info.return_value=NS(connected=True,trade_allowed=True,tradeapi_disabled=False)
  self.api.positions_get.return_value=();self.api.orders_get.return_value=()
  self.info=NS(trade_mode=4,order_mode=49,trade_tick_size=.00001,point=.00001,trade_stops_level=0,digits=5,volume_step=.01,volume_min=.01,volume_max=100,filling_mode=2,trade_exemode=2)
  self.api.symbol_info.return_value=self.info
  self.api.symbol_info_tick.return_value=NS(time_msc=self.now*1000,time=self.now,bid=1.1,ask=1.1001)
  self.api.order_calc_profit.return_value=-200.;self.api.order_calc_margin.return_value=50.
  self.api.order_check.return_value=NS(retcode=0)
  self.api.order_send.return_value=NS(retcode=10009,order=1,deal=2,volume=.11,price=1.1001)
  self.control={'permissionVersion':1,'observedAt':self.iso(self.now)}
  self.packet={'symbol':'EURUSD','brokerSymbol':'EURUSD','m5':[{'time':(self.now-300)*1000}]}
  self.obs={'EURUSD':(self.packet,{'dataIssues':[],'demoObservation':{'symbol':'EURUSD','newsAssessed':True,'bias':'BUY','expiresAt':self.iso(self.now+150)}})}
  self.pilot=DemoPilot(self.root,self.cfg,self.api,lambda:self.now)
  self.signal=patch('demo_pilot.technical_signal',return_value=('BUY',.001));self.signal.start()
  self.addCleanup(self.signal.stop);self.addCleanup(self.tmp.cleanup)
  arm(self.root,self.cfg,self.now)
 def iso(self,t):return datetime.fromtimestamp(t,timezone.utc).isoformat()
 def step(self):return self.pilot.step(self.obs,control=self.control)
 def test_demo_submission_has_risk_sized_volume_and_protection(self):
  self.assertEqual(self.step()['phase'],'FILLED');r=self.api.order_send.call_args.args[0]
  self.assertLessEqual(r['volume']*200,10000*.0025*.9)
  self.assertLess(r['sl'],r['price']);self.assertGreater(r['tp'],r['price']);self.assertEqual(r['type_filling'],1)
 def test_real_account_and_switch_never_send(self):
  for field,value in [('trade_mode',2),('login',321),('server','Other')]:
   old=getattr(self.account,field);setattr(self.account,field,value)
   self.assertEqual(self.step()['phase'],'REAL_BLOCKED');setattr(self.account,field,old)
  self.api.order_send.assert_not_called()
 def test_off_expired_and_missing_ack_never_send(self):
  self.assertEqual(self.pilot.step(self.obs)['phase'],'DATA')
  self.now+=7201;self.control['observedAt']=self.iso(self.now)
  self.assertEqual(self.step()['phase'],'EXPIRED');disarm(self.root);self.assertEqual(self.step()['phase'],'OFF')
  self.api.order_send.assert_not_called()
 def test_permissions_positions_and_pending_block(self):
  self.api.terminal_info.return_value.trade_allowed=False;self.assertEqual(self.step()['phase'],'ALGO_OFF')
  self.api.terminal_info.return_value.trade_allowed=True
  for name in ['positions_get','orders_get']:
   getattr(self.api,name).return_value=(NS(ticket=1),);self.assertEqual(self.step()['phase'],'POSITION_EXISTS');getattr(self.api,name).return_value=()
  self.api.order_send.assert_not_called()
 def test_stale_ai_no_trade_and_data_errors_never_send(self):
  response=self.obs['EURUSD'][1];o=response['demoObservation']
  for change in [{'bias':'NO_TRADE'},{'bias':'SELL'},{'expiresAt':self.iso(self.now-1)},{'newsAssessed':False}]:
   original=dict(o);o.update(change);self.assertEqual(self.step()['phase'],'WAITING');o.clear();o.update(original)
  response['dataIssues']=['STALE_QUOTE'];self.step();self.api.order_send.assert_not_called()
 def test_spread_stale_tick_and_minimum_lot_never_send(self):
  tick=self.api.symbol_info_tick.return_value;tick.ask=1.102;self.step();tick.ask=1.1001
  tick.time_msc=(self.now-60)*1000;self.step();tick.time_msc=self.now*1000
  self.info.volume_min=1;self.step();self.api.order_send.assert_not_called()
 def test_loss_limit_and_server_stop(self):
  self.step();self.account.equity=9899;self.assertEqual(self.step()['phase'],'LOSS_LIMIT')
  arm(self.root,self.cfg,self.now);self.step();self.control['permissionVersion']=2;self.assertEqual(self.step()['phase'],'OFF');self.assertIsNone(self.pilot.settings())
  self.assertEqual(self.api.order_send.call_count,1)
 def test_uncertain_send_freezes_after_restart(self):
  for reply in [None,NS(retcode=10008)]:
   with self.subTest(reply=reply):
    self.api.order_send.return_value=reply
    self.assertEqual(self.step()['phase'],'UNKNOWN')
    other=DemoPilot(self.root,self.cfg,self.api,lambda:self.now)
    self.assertEqual(other.step(self.obs,control=self.control)['phase'],'UNKNOWN')
    self.assertEqual(self.api.order_send.call_count,1)
 def test_exception_send_never_retries(self):
  self.api.order_send.side_effect=TimeoutError();self.assertEqual(self.step()['phase'],'UNKNOWN');self.step();self.api.order_send.assert_called_once()
 def test_precheck_failure_is_durable_and_cools_down(self):
  self.api.order_check.return_value=NS(retcode=10016);self.assertEqual(self.step()['phase'],'REJECTED')
  self.assertEqual(self.step()['phase'],'COOLDOWN');self.api.order_check.assert_called_once();self.api.order_send.assert_not_called()
 def test_same_closed_bar_cannot_send_even_new_session(self):
  self.step();arm(self.root,self.cfg,self.now);self.step();self.api.order_send.assert_called_once()
 def test_stop_during_precheck_prevents_send(self):
  def check(request):disarm(self.root);return NS(retcode=0)
  self.api.order_check.side_effect=check;self.assertEqual(self.step()['phase'],'OFF');self.api.order_send.assert_not_called()
 def test_three_attempt_limit(self):
  s=self.pilot.settings()
  with self.pilot.db() as db:
   for i in range(3):db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?,?)',(str(i),'Demo:123',s['sessionId'],self.now-2000,'REJECTED','{}','{}'))
  self.assertEqual(self.step()['phase'],'LIMIT');self.api.order_send.assert_not_called()

class IndicatorTests(unittest.TestCase):
 def test_closed_oscillating_trend_and_stale_data(self):
  import math
  now=1800000000.;packet={}
  for name,interval in [('m5',300),('h1',3600)]:
   end=math.floor(now/interval)*interval-interval
   packet[name]=[dict(time=(end-(259-i)*interval)*1000,open=100+i*.01+math.sin(i)*.1,close=100+i*.01+math.sin(i)*.1,high=100+i*.01+math.sin(i)*.1+.1,low=100+i*.01+math.sin(i)*.1-.1) for i in range(260)]
  signal=technical_signal(packet,now)
  self.assertIsNotNone(signal);self.assertEqual(signal[0],'BUY')
  self.assertIsNone(technical_signal(packet,now+7200))
  packet['m5'][-1]['close']=float('nan');self.assertIsNone(technical_signal(packet,now))

if __name__=='__main__':unittest.main()
