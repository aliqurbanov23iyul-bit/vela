import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {digest,equal} from './security';
import {demoObservation} from './demo-observation';
export const agentIdentity=z.object({tenantId:z.string().uuid(),accountId:z.string().uuid(),login:z.string(),server:z.string()});
export const brokerRequest=z.object({action:z.literal(1),symbol:z.string().min(1).max(64),volume:z.number().finite().positive().max(100),type:z.union([z.literal(0),z.literal(1)]),price:z.number().finite().positive(),sl:z.number().finite().positive(),tp:z.number().finite().positive(),deviation:z.literal(10),magic:z.literal(2601023),comment:z.string().regex(/^VELA-DEMO-[a-f0-9-]{8}$/),type_time:z.literal(0),type_filling:z.union([z.literal(0),z.literal(1),z.literal(2)])}).strict().refine(r=>r.type===0?r.sl<r.price&&r.price<r.tp:r.tp<r.price&&r.price<r.sl);
export const demoCandidate=agentIdentity.extend({operation:z.literal('prepare'),sessionId:z.string().uuid(),testMode:z.boolean().optional(),symbol:z.enum(['EURUSD','XAUUSD']),barAt:z.string().datetime(),plannedRiskMoney:z.number().finite().positive().max(1000000000).optional(),request:brokerRequest}).strict();
export const demoClaim=agentIdentity.extend({operation:z.literal('claim'),sessionId:z.string().uuid(),candidateId:z.string().uuid()}).strict();
export const demoDeal=z.object({ticket:z.string().regex(/^\d{1,24}$/),positionId:z.string().regex(/^\d{1,24}$/),symbol:z.string().min(1).max(64),side:z.enum(['BUY','SELL']),entry:z.enum(['IN','OUT','INOUT','OUT_BY']),volume:z.number().finite().positive(),price:z.number().finite().positive(),profit:z.number().finite(),commission:z.number().finite(),swap:z.number().finite(),fee:z.number().finite(),at:z.string().datetime(),magic:z.number().int().nonnegative(),botPosition:z.literal(true),sessionId:z.string().uuid().nullable().optional()}).strict();
type Agent=z.infer<typeof agentIdentity>;
export async function authenticatedDemo(db:PoolClient,b:Agent,raw:string){
 const a=(await db.query('SELECT a.*,u.disabled,t.suspended FROM accounts a JOIN users u ON u.id=a.owner_id JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 FOR UPDATE OF a',[b.accountId])).rows[0];
 if(!a?.agent_token_hash||!equal(digest(raw),a.agent_token_hash)||a.broker_login!==b.login||a.server!==b.server||a.account_type!=='DEMO'||a.disabled||a.suspended)throw Error('AUTH');return a;
}
export const demoOptions=z.object({durationHours:z.number().int().min(1).max(24).nullable().default(2),tradeLimit:z.number().int().min(1).max(1000000).nullable().default(null),frequency:z.enum(['SIGNAL','HOURLY','QUICK']).default('SIGNAL'),testMode:z.boolean().default(false)});
export type DemoOptions=z.infer<typeof demoOptions>;
export async function sessionProgress(db:PoolClient,account:string,session:string){
 const rows=(await db.query(`SELECT count(*) FILTER(WHERE opened>0)::int AS opened,count(*) FILTER(WHERE opened>0 AND closed>=opened-0.00000001)::int AS completed FROM (
 SELECT payload->>'positionId' AS position,sum(CASE WHEN payload->>'entry'='IN' THEN (payload->>'volume')::numeric ELSE 0 END) AS opened,
 sum(CASE WHEN payload->>'entry' IN('OUT','OUT_BY') THEN (payload->>'volume')::numeric ELSE 0 END) AS closed
 FROM demo_deals WHERE account_id=$1 AND payload->>'sessionId'=$2 GROUP BY payload->>'positionId') positions`,[account,session])).rows[0];
 const attempts=(await db.query("SELECT count(*) FILTER(WHERE claimed_at IS NOT NULL AND execution_state IS DISTINCT FROM 'REJECTED')::int AS reserved,count(*) FILTER(WHERE execution_state='FILLED')::int AS filled,max(claimed_at) FILTER(WHERE execution_state IS DISTINCT FROM 'REJECTED') AS last FROM demo_candidates WHERE account_id=$1 AND session_id=$2",[account,session])).rows[0];
 return {openedTrades:Math.max(rows.opened,attempts.filled),completedTrades:rows.completed,reservedTrades:attempts.reserved,lastEntry:attempts.last};
}
export async function demoRun(db:PoolClient,account:string){
 const c=(await db.query('SELECT d.*,a.permission_version AS account_permission FROM demo_control d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1',[account])).rows[0];
 if(!c)return null;
 const progress=await sessionProgress(db,account,c.session_id);
 const reason=c.stop_reason??(c.permission_version!==c.account_permission?'MANUAL':c.expires_at&&new Date(c.expires_at).getTime()<=Date.now()?'TIME_LIMIT':c.trade_limit!==null&&progress.completedTrades>=c.trade_limit?'COUNT_LIMIT':null);
 if(c.enabled&&reason)await db.query('UPDATE demo_control SET enabled=false,stop_reason=$1 WHERE account_id=$2 AND session_id=$3',[reason,account,c.session_id]);
 return {sessionId:c.session_id,enabled:c.enabled&&!reason,mode:c.mode,testMode:c.test_mode===true,startedAt:new Date(c.started_at).toISOString(),expiresAt:c.expires_at?new Date(c.expires_at).toISOString():null,durationHours:c.duration_hours,tradeLimit:c.trade_limit,frequency:c.frequency,stopReason:reason,...progress};
}
export async function controlDemo(db:PoolClient,user:string,account:string,operation:'start'|'stop',mode:'AUTO'|'TELEGRAM',input:Partial<DemoOptions>={}){
 const options=demoOptions.parse(input);
 const a=(await db.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[account])).rows[0];
 if(!a||a.owner_id!==user)throw Error('FORBIDDEN');
 if(operation==='start'){
  if(options.testMode&&mode!=='TELEGRAM')throw Error('TEST_REQUIRES_TELEGRAM');
  if(options.frequency==='QUICK'&&(!options.testMode||mode!=='TELEGRAM'))throw Error('QUICK_REQUIRES_TEST');
  if(options.frequency==='QUICK'&&a.snapshot?.demoProtocol!==3)throw Error('QUICK_CONNECTOR');
  if(a.account_type!=='DEMO')throw Error('DEMO_ONLY');
  if(!a.heartbeat||Date.now()-new Date(a.heartbeat).getTime()>45000||![2,3].includes(a.snapshot?.demoProtocol??0))throw Error('CONNECTOR');
  if(mode==='TELEGRAM'&&!(await db.query('SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[user])).rowCount)throw Error('TELEGRAM');
  const current=await demoRun(db,account);if(current?.enabled){
   if(current.mode===mode&&current.durationHours===options.durationHours&&current.tradeLimit===options.tradeLimit&&current.frequency===options.frequency&&current.testMode===options.testMode)return current;
   throw Error('STOP_FIRST');
  }
 }
 const v=(await db.query('UPDATE accounts SET permission_version=permission_version+1,stopped=true WHERE id=$1 RETURNING permission_version',[account])).rows[0].permission_version;
 if(operation==='stop')await db.query("UPDATE demo_control SET enabled=false,stop_reason='MANUAL',permission_version=$1 WHERE account_id=$2",[v,account]);
 else await db.query(`INSERT INTO demo_control(account_id,tenant_id,session_id,enabled,mode,started_at,expires_at,permission_version,duration_hours,trade_limit,frequency,test_mode)
 VALUES($1,$2,$3,true,$4,now(),CASE WHEN $6::integer IS NULL THEN NULL ELSE now()+($6*interval '1 hour') END,$5,$6,$7,$8,$9)
 ON CONFLICT(account_id) DO UPDATE SET session_id=excluded.session_id,enabled=true,mode=excluded.mode,started_at=excluded.started_at,expires_at=excluded.expires_at,permission_version=excluded.permission_version,duration_hours=excluded.duration_hours,trade_limit=excluded.trade_limit,frequency=excluded.frequency,test_mode=excluded.test_mode,stop_reason=NULL`,[account,a.tenant_id,randomUUID(),mode,v,options.durationHours,options.tradeLimit,options.frequency,options.testMode]);
 await db.query('INSERT INTO audit(tenant_id,actor_id,account_id,event,data) VALUES($1,$2,$3,$4,$5)',[a.tenant_id,user,account,operation==='start'?'DEMO_STARTED':'DEMO_STOPPED',JSON.stringify({mode,...options})]);
 return demoRun(db,account);
}
async function activeRun(db:PoolClient,account:string,session:string){const run=await demoRun(db,account);if(!run?.enabled||run.sessionId!==session)throw Error('STOPPED');return run;}
async function entryCapacity(db:PoolClient,account:string,run:NonNullable<Awaited<ReturnType<typeof demoRun>>>){
 if(run.tradeLimit!==null&&Math.max(run.openedTrades,run.reservedTrades)>=run.tradeLimit)throw Error('COUNT_PENDING');
 if(run.lastEntry&&Date.now()-new Date(run.lastEntry).getTime()<(run.frequency==='HOURLY'?3600000:run.frequency==='QUICK'?60000:1800000))throw Error('COOLDOWN');
 if((await db.query("SELECT 1 FROM demo_candidates WHERE account_id=$1 AND claimed_at IS NOT NULL AND (execution_state IS NULL OR execution_state='UNKNOWN') LIMIT 1",[account])).rowCount)throw Error('UNRESOLVED');
}
async function freshBias(db:PoolClient,account:string,symbol:string,request:z.infer<typeof brokerRequest>){
 const preferences=(await db.query('SELECT enabled,symbols FROM ai_preferences LIMIT 1')).rows[0];
 if(preferences&&(!preferences.enabled||!preferences.symbols.includes(symbol)))throw Error('STALE_SIGNAL');
 const market=(await db.query("SELECT broker_symbol,summary FROM market_latest WHERE account_id=$1 AND symbol=$2 AND received_at>now()-interval '90 seconds'",[account,symbol])).rows[0];
 const ai=(await db.query("SELECT status,result FROM market_analysis_runs WHERE account_id=$1 AND symbol=$2 ORDER BY created_at DESC LIMIT 1",[account,symbol])).rows[0];
 const observation=demoObservation(symbol,ai?.status,ai?.result);
 if(!market||market.broker_symbol!==request.symbol||market.summary?.dataIssues?.length!==0||!observation||observation.bias!==(request.type===0?'BUY':'SELL'))throw Error('STALE_SIGNAL');
 return observation;
}
async function freshTestMarket(db:PoolClient,account:string,symbol:string,request:z.infer<typeof brokerRequest>,quick=false,expectedBarAt?:string){
 const market=(await db.query("SELECT broker_symbol,summary,received_at FROM market_latest WHERE account_id=$1 AND symbol=$2",[account,symbol])).rows[0];
 if(!market||market.broker_symbol!==request.symbol||market.summary?.dataIssues?.length!==0||Date.now()-new Date(market.received_at).getTime()>90000)throw Error('STALE_SIGNAL');
 if(quick&&(!Array.isArray(market.summary?.m1)||market.summary?.m1DataIssues?.length||!expectedBarAt||Date.parse(market.summary?.lastM1)!==Date.parse(expectedBarAt)))throw Error('STALE_SIGNAL');
}
export async function prepareDemo(db:PoolClient,b:z.infer<typeof demoCandidate>,raw:string){
 const a=await authenticatedDemo(db,b,raw),run=await activeRun(db,b.accountId,b.sessionId);
 let row=(await db.query('SELECT * FROM demo_candidates WHERE session_id=$1 AND symbol=$2 AND bar_at=$3',[b.sessionId,b.symbol,b.barAt])).rows[0];
 if(!row){
  if((b.testMode===true)!==run.testMode)throw Error('STALE_SIGNAL');
  const observation=b.testMode===true?(await freshTestMarket(db,b.accountId,b.symbol,b.request,run.frequency==='QUICK',b.barAt),{expiresAt:new Date(Date.now()+(run.frequency==='QUICK'?60000:90000)).toISOString()}):await freshBias(db,b.accountId,b.symbol,b.request);
  const interval=run.frequency==='QUICK'?60000:300000,minAge=interval,maxAge=run.frequency==='QUICK'?125000:620000;
  if(Date.now()-Date.parse(b.barAt)<minAge||Date.now()-Date.parse(b.barAt)>maxAge||b.request.comment!=='VELA-DEMO-'+b.sessionId.slice(0,8))throw Error('STALE_SIGNAL');
  await entryCapacity(db,b.accountId,run);
  if(Date.parse(b.barAt)%interval!==0)throw Error('STALE_SIGNAL');
  const id=randomUUID(),approval=run.mode==='TELEGRAM'?randomUUID():null;
  const expires=new Date(Math.min(run.expiresAt?Date.parse(run.expiresAt):Infinity,Date.parse(observation.expiresAt),Date.now()+(run.frequency==='QUICK'?60000:120000)));
  const snapshot=a.snapshot as {equity?:number;currency?:string}|null;
  const equity=Number(snapshot?.equity);
  if(b.plannedRiskMoney!==undefined&&(!Number.isFinite(equity)||equity<=0||b.plannedRiskMoney>equity*.0025))throw Error('STALE_SIGNAL');
  const riskPercent=b.plannedRiskMoney!==undefined?b.plannedRiskMoney/equity*100:0.25;
  const payload={demo:true,testMode:run.testMode,quickMode:run.frequency==='QUICK',symbol:b.symbol,side:b.request.type===0?'BUY':'SELL',entry:b.request.price,stop:b.request.sl,take:b.request.tp,volume:b.request.volume,riskMoney:b.plannedRiskMoney,riskPercent,riskCapPercent:0.25,currency:snapshot?.currency};
  await db.query('INSERT INTO proposals(id,tenant_id,account_id,version,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,b.tenantId,b.accountId,a.permission_version,JSON.stringify(payload),expires]);
  if(approval)await db.query('INSERT INTO approvals(id,tenant_id,user_id,account_id,proposal_id,proposal_version,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[approval,b.tenantId,a.owner_id,b.accountId,id,a.permission_version,digest(randomUUID()),expires]);
  row=(await db.query('INSERT INTO demo_candidates(id,tenant_id,account_id,session_id,mode,symbol,bar_at,request,approval_id,expires_at,test_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[id,b.tenantId,b.accountId,b.sessionId,run.mode,b.symbol,b.barAt,JSON.stringify(b.request),approval,expires,b.testMode===true])).rows[0];
 }
 if(row.account_id!==b.accountId||row.mode!==run.mode||row.execution_state||row.claimed_at||new Date(row.expires_at).getTime()<=Date.now())return {state:'EXPIRED'};
 const decision=row.approval_id?(await db.query('SELECT decision FROM approvals WHERE id=$1',[row.approval_id])).rows[0]?.decision:'APPROVED';
 const state=decision==='APPROVED'?'APPROVED':decision==='REJECTED'?'REJECTED':'PENDING';
 let notification=null;
 if(state==='PENDING'){
  const link=(await db.query('SELECT telegram_id FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[a.owner_id])).rows[0];if(!link)throw Error('TELEGRAM');
  const lease=await db.query("UPDATE demo_candidates SET notification_lease=now()+interval '30 seconds',delivery_attempts=delivery_attempts+1 WHERE id=$1 AND notified_at IS NULL AND (notification_lease IS NULL OR notification_lease<now()) AND delivery_attempts<3 RETURNING id",[row.id]);
  if(lease.rowCount){const snapshot=a.snapshot as {equity?:number;currency?:string}|null;const riskMoney=b.plannedRiskMoney;const equity=Number(snapshot?.equity);notification={id:row.id,approvalId:row.approval_id,chat:link.telegram_id,label:a.label,request:row.request,quickMode:run.frequency==='QUICK',riskMoney,riskPercent:riskMoney!==undefined&&Number.isFinite(equity)&&equity>0?riskMoney/equity*100:null,currency:snapshot?.currency,expiresAt:row.expires_at};}
 }
 return {state,id:row.id,request:row.request,expiresAt:new Date(row.expires_at).toISOString(),notification};
}
export async function claimDemo(db:PoolClient,b:z.infer<typeof demoClaim>,raw:string){
 const a=await authenticatedDemo(db,b,raw),run=await activeRun(db,b.accountId,b.sessionId);
 const c=(await db.query('SELECT * FROM demo_candidates WHERE id=$1 AND account_id=$2 AND session_id=$3 FOR UPDATE',[b.candidateId,b.accountId,b.sessionId])).rows[0];
 if(!c||c.execution_state||c.claimed_at||c.mode!==run.mode||new Date(c.expires_at).getTime()<=Date.now())throw Error('EXPIRED');
 await entryCapacity(db,b.accountId,run);
  if(c.test_mode!==run.testMode)throw Error('STALE_SIGNAL');
  if(c.test_mode)await freshTestMarket(db,b.accountId,c.symbol,c.request,run.frequency==='QUICK',c.bar_at instanceof Date?c.bar_at.toISOString():String(c.bar_at));else await freshBias(db,b.accountId,c.symbol,c.request);
 if(c.mode==='TELEGRAM'){
  const approval=(await db.query("SELECT 1 FROM approvals p JOIN telegram_links l ON l.user_id=p.user_id WHERE p.id=$1 AND p.user_id=$2 AND p.account_id=$3 AND p.decision='APPROVED' AND p.consumed_at IS NOT NULL AND p.expires_at>now() AND p.proposal_version=$4 AND l.telegram_id IS NOT NULL",[c.approval_id,a.owner_id,b.accountId,a.permission_version])).rowCount;
  if(!approval)throw Error('APPROVAL_REQUIRED');
 }
 await db.query('UPDATE demo_candidates SET claimed_at=now() WHERE id=$1',[c.id]);
 await db.query("INSERT INTO audit(tenant_id,actor_id,account_id,event,data) VALUES($1,$2,$3,'DEMO_ENTRY_CLAIMED',$4)",[b.tenantId,a.owner_id,b.accountId,JSON.stringify({candidateId:c.id,mode:c.mode})]);
 return {ok:true,request:c.request};
}

export const demoOutcome=agentIdentity.extend({operation:z.literal('report'),candidateId:z.string().uuid(),state:z.enum(['FILLED','REJECTED','UNKNOWN']),result:z.record(z.string(),z.union([z.number().finite(),z.string().max(40),z.null()])).refine(r=>Object.keys(r).every(k=>['retcode','order','deal','volume','price'].includes(k)))}).strict();
export async function reportDemo(db:PoolClient,b:z.infer<typeof demoOutcome>,raw:string){
 await authenticatedDemo(db,b,raw);
 if(b.state==='FILLED'&&(![10009,10010].includes(Number(b.result.retcode))||!(Number(b.result.order)>0||Number(b.result.deal)>0)))throw Error('INVALID_RESULT');
 const row=(await db.query('SELECT claimed_at,execution_state FROM demo_candidates WHERE id=$1 AND account_id=$2 FOR UPDATE',[b.candidateId,b.accountId])).rows[0];
 if(!row||(!row.claimed_at&&b.state!=='REJECTED'))throw Error('INVALID_RESULT');
 if(row.execution_state&&row.execution_state!==b.state)throw Error('RESULT_CONFLICT');
 await db.query('UPDATE demo_candidates SET execution_state=$1,execution_result=$2,reported_at=COALESCE(reported_at,now()) WHERE id=$3 AND account_id=$4',[b.state,JSON.stringify(b.result),b.candidateId,b.accountId]);return {ok:true};
}
export const demoHalt=agentIdentity.extend({operation:z.literal('halt'),sessionId:z.string().uuid().optional(),reason:z.enum(['MANUAL','LOSS_LIMIT','UPGRADE'])}).strict();
export async function haltDemo(db:PoolClient,b:z.infer<typeof demoHalt>,raw:string){
 await authenticatedDemo(db,b,raw);
 if(b.sessionId)await db.query('UPDATE demo_control SET enabled=false,stop_reason=$1 WHERE account_id=$2 AND session_id=$3',[b.reason,b.accountId,b.sessionId]);
 else await db.query('UPDATE demo_control SET enabled=false,stop_reason=$1 WHERE account_id=$2 AND enabled=true',[b.reason,b.accountId]);
 return {ok:true};
}
