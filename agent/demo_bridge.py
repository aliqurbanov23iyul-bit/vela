"""Authenticated website control and single-use demo grants. No terminal writes."""
from datetime import datetime, timezone, timedelta
import requests


class DemoApprovalClient:
    def __init__(self,config):
        self.config=config

    def post(self,body):
        c=self.config
        identity={'accountId':c['MT5_ACCOUNT_ID'],'tenantId':c['MT5_TENANT_ID'],
                  'login':c['MT5_LOGIN'],'server':c['MT5_SERVER']}
        r=requests.post(c['APP_ORIGIN']+'/api/agent/demo',json={**identity,**body},
                        headers={'Authorization':'Bearer '+c['MT5_AGENT_TOKEN']},timeout=15)
        data=r.json()
        if not r.ok:return {'state':data.get('state','REJECTED')}
        return data

    def prepare(self,settings,packet,request):
        return self.post({'operation':'prepare','sessionId':settings['sessionId'],
                          'symbol':packet['symbol'],
                          'barAt':datetime.fromtimestamp(packet['m5'][-1]['time']/1000,timezone.utc).isoformat().replace('+00:00','Z'),
                          'request':request})

    def claim(self,settings,candidate):
        return self.post({'operation':'claim','sessionId':settings['sessionId'],'candidateId':candidate})

    def report(self,candidate,state,result):
        return self.post({'operation':'report','candidateId':candidate,'state':state,'result':result})

    def halt(self,settings,reason):
        body={'operation':'halt','reason':reason}
        if settings and settings.get('sessionId'):body['sessionId']=settings['sessionId']
        return self.post(body)


def collect_deals(api,offset_minutes,now=None,session_ids=None,positions=None):
    now=now or datetime.now(timezone.utc)
    # Extended query window also covers configured broker wall-clock epochs.
    deals=api.history_deals_get(now-timedelta(days=8),now+timedelta(days=1))
    if deals is None:raise RuntimeError('History unavailable')
    session_ids=session_ids or {}
    positions=positions if positions is not None else {}
    for d in deals:
        if d.magic==2601023:
            positions[str(d.position_id)]=positions.get(str(d.position_id)) or session_ids.get(str(getattr(d,'comment',''))[:18])
    owned={int(p) for p in positions}
    selected=sorted((d for d in deals if d.position_id in owned and d.type in (0,1) and d.entry in (0,1,2,3) and d.volume>0),key=lambda d:d.time_msc)[-200:]
    return [dict(ticket=str(d.ticket),positionId=str(d.position_id),symbol=d.symbol,
                 side='BUY' if d.type==0 else 'SELL',entry=('IN','OUT','INOUT','OUT_BY')[d.entry],
                 volume=d.volume,price=d.price,profit=d.profit,commission=d.commission,swap=d.swap,fee=d.fee,
                 at=datetime.fromtimestamp((d.time_msc or d.time*1000)/1000-offset_minutes*60,timezone.utc).isoformat().replace('+00:00','Z'),magic=d.magic,botPosition=True,sessionId=positions.get(str(d.position_id))) for d in selected]
