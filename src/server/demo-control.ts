import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {digest,equal} from './security';
import {demoObservation} from './demo-observation';
export const agentIdentity=z.object({tenantId:z.string().uuid(),accountId:z.string().uuid(),login:z.string(),server:z.string()});
export const brokerRequest=z.object({action:z.literal(1),symbol:z.string().min(1).max(64),volume:z.number().finite().positive().max(100),type:z.union([z.literal(0),z.literal(1)]),price:z.number().finite().positive(),sl:z.number().finite().positive(),tp:z.number().finite().positive(),deviation:z.literal(10),magic:z.literal(2601023),comment:z.string().regex(/^VELA-DEMO-[a-f0-9-]{8}$/),type_time:z.literal(0),type_filling:z.union([z.literal(0),z.literal(1),z.literal(2)])}).strict().refine(r=>r.type===0?r.sl<r.price&&r.price<r.tp:r.tp<r.price&&r.price<r.sl);
export const demoCandidate=agentIdentity.extend({operation:z.literal('prepare'),sessionId:z.string().uuid(),symbol:z.enum(['EURUSD','XAUUSD']),barAt:z.string().datetime(),request:brokerRequest}).strict();
export const demoClaim=agentIdentity.extend({operation:z.literal('claim'),sessionId:z.string().uuid(),candidateId:z.string().uuid()}).strict();
export const demoDeal=z.object({ticket:z.string().regex(/^\d{1,24}$/),positionId:z.string().regex(/^\d{1,24}$/),symbol:z.string().min(1).max(64),side:z.enum(['BUY','SELL']),entry:z.enum(['IN','OUT','INOUT','OUT_BY']),volume:z.number().finite().positive(),price:z.number().finite().positive(),profit:z.number().finite(),commission:z.number().finite(),swap:z.number().finite(),fee:z.number().finite(),at:z.string().datetime(),magic:z.number().int().nonnegative(),botPosition:z.literal(true)}).strict();
type Agent=z.infer<typeof agentIdentity>;
export async function authenticatedDemo(db:PoolClient,b:Agent,raw:string){
 const a=(await db.query('SELECT a.*,u.disabled,t.suspended FROM accounts a JOIN users u ON u.id=a.owner_id JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 FOR UPDATE OF a',[b.accountId])).rows[0];
 if(!a?.agent_token_hash||!equal(digest(raw),a.agent_token_hash)||a.broker_login!==b.login||a.server!==b.server||a.account_type!=='DEMO'||a.disabled||a.suspended)throw Error('AUTH');return a;
}
export async function demoRun(db:PoolClient,account:string){
 const c=(await db.query('SELECT d.* FROM demo_control d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 AND d.permission_version=a.permission_version',[account])).rows[0];
 return c?{sessionId:c.session_id,enabled:c.enabled&&new Date(c.expires_at).getTime()>Date.now(),mode:c.mode,startedAt:new Date(c.started_at).toISOString(),expiresAt:new Date(c.expires_at).toISOString()}:null;
}
export async function controlDemo(db:PoolClient,user:string,account:string,operation:'start'|'stop',mode:'AUTO'|'TELEGRAM'){
 const a=(await db.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[account])).rows[0];
 if(!a||a.owner_id!==user)throw Error('FORBIDDEN');
 if(operation==='start'){
  if(a.account_type!=='DEMO')throw Error('DEMO_ONLY');
  if(!a.heartbeat||Date.now()-new Date(a.heartbeat).getTime()>45000||a.snapshot?.demoProtocol!==1)throw Error('CONNECTOR');
  if(mode==='TELEGRAM'&&!(await db.query('SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[user])).rowCount)throw Error('TELEGRAM');
  const current=await demoRun(db,account);if(current?.enabled&&current.mode===mode)return current;
 }
 const v=(await db.query('UPDATE accounts SET permission_version=permission_version+1,stopped=true WHERE id=$1 RETURNING permission_version',[account])).rows[0].permission_version;
 if(operation==='stop')await db.query('UPDATE demo_control SET enabled=false WHERE account_id=$1',[account]);
 else await db.query("INSERT INTO demo_control(account_id,tenant_id,session_id,enabled,mode,started_at,expires_at,permission_version) VALUES($1,$2,$3,true,$4,now(),now()+interval '2 hours',$5) ON CONFLICT(account_id) DO UPDATE SET session_id=excluded.session_id,enabled=true,mode=excluded.mode,started_at=excluded.started_at,expires_at=excluded.expires_at,permission_version=excluded.permission_version",[account,a.tenant_id,randomUUID(),mode,v]);
 await db.query('INSERT INTO audit(tenant_id,actor_id,account_id,event,data) VALUES($1,$2,$3,$4,$5)',[a.tenant_id,user,account,operation==='start'?'DEMO_STARTED':'DEMO_STOPPED',JSON.stringify({mode})]);
 return demoRun(db,account);
}
async function activeRun(db:PoolClient,account:string,session:string){const run=await demoRun(db,account);if(!run?.enabled||run.sessionId!==session)throw Error('STOPPED');return run;}
async function freshBias(db:PoolClient,account:string,symbol:string,request:z.infer<typeof brokerRequest>){
 const preferences=(await db.query('SELECT enabled,symbols FROM ai_preferences LIMIT 1')).rows[0];
 if(preferences&&(!preferences.enabled||!preferences.symbols.includes(symbol)))throw Error('STALE_SIGNAL');
 const market=(await db.query("SELECT broker_symbol,summary FROM market_latest WHERE account_id=$1 AND symbol=$2 AND received_at>now()-interval '90 seconds'",[account,symbol])).rows[0];
 const ai=(await db.query("SELECT status,result FROM market_analysis_runs WHERE account_id=$1 AND symbol=$2 ORDER BY created_at DESC LIMIT 1",[account,symbol])).rows[0];
 const observation=demoObservation(symbol,ai?.status,ai?.result);
 if(!market||market.broker_symbol!==request.symbol||market.summary?.dataIssues?.length!==0||!observation||observation.bias!==(request.type===0?'BUY':'SELL'))throw Error('STALE_SIGNAL');
 return observation;
}
export async function prepareDemo(db:PoolClient,b:z.infer<typeof demoCandidate>,raw:string){
 const a=await authenticatedDemo(db,b,raw),run=await activeRun(db,b.accountId,b.sessionId);
 let row=(await db.query('SELECT * FROM demo_candidates WHERE session_id=$1 AND symbol=$2 AND bar_at=$3',[b.sessionId,b.symbol,b.barAt])).rows[0];
 if(!row){
  const observation=await freshBias(db,b.accountId,b.symbol,b.request);
  if(Date.now()-Date.parse(b.barAt)<300000||Date.now()-Date.parse(b.barAt)>620000||b.request.comment!=='VELA-DEMO-'+b.sessionId.slice(0,8))throw Error('STALE_SIGNAL');
  const count=(await db.query('SELECT count(*)::int AS n FROM demo_candidates WHERE session_id=$1',[b.sessionId])).rows[0].n;if(count>=3)throw Error('LIMIT');
  const id=randomUUID(),approval=run.mode==='TELEGRAM'?randomUUID():null;
  const expires=new Date(Math.min(Date.parse(run.expiresAt),Date.parse(observation.expiresAt),Date.now()+120000));
  const payload={demo:true,symbol:b.symbol,side:b.request.type===0?'BUY':'SELL',entry:b.request.price,stop:b.request.sl,take:b.request.tp,volume:b.request.volume,riskPercent:0.25};
  await db.query('INSERT INTO proposals(id,tenant_id,account_id,version,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,b.tenantId,b.accountId,a.permission_version,JSON.stringify(payload),expires]);
  if(approval)await db.query('INSERT INTO approvals(id,tenant_id,user_id,account_id,proposal_id,proposal_version,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[approval,b.tenantId,a.owner_id,b.accountId,id,a.permission_version,digest(randomUUID()),expires]);
  row=(await db.query('INSERT INTO demo_candidates(id,tenant_id,account_id,session_id,mode,symbol,bar_at,request,approval_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,b.tenantId,b.accountId,b.sessionId,run.mode,b.symbol,b.barAt,JSON.stringify(b.request),approval,expires])).rows[0];
 }
 if(row.account_id!==b.accountId||row.mode!==run.mode||row.claimed_at||new Date(row.expires_at).getTime()<=Date.now())return {state:'EXPIRED'};
 const decision=row.approval_id?(await db.query('SELECT decision FROM approvals WHERE id=$1',[row.approval_id])).rows[0]?.decision:'APPROVED';
 const state=decision==='APPROVED'?'APPROVED':decision==='REJECTED'?'REJECTED':'PENDING';
 let notification=null;
 if(state==='PENDING'){
  const link=(await db.query('SELECT telegram_id FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[a.owner_id])).rows[0];if(!link)throw Error('TELEGRAM');
  const lease=await db.query("UPDATE demo_candidates SET notification_lease=now()+interval '30 seconds',delivery_attempts=delivery_attempts+1 WHERE id=$1 AND notified_at IS NULL AND (notification_lease IS NULL OR notification_lease<now()) AND delivery_attempts<3 RETURNING id",[row.id]);
  if(lease.rowCount)notification={id:row.id,approvalId:row.approval_id,chat:link.telegram_id,label:a.label,request:row.request,expiresAt:row.expires_at};
 }
 return {state,id:row.id,request:row.request,expiresAt:new Date(row.expires_at).toISOString(),notification};
}
export async function claimDemo(db:PoolClient,b:z.infer<typeof demoClaim>,raw:string){
 const a=await authenticatedDemo(db,b,raw),run=await activeRun(db,b.accountId,b.sessionId);
 const c=(await db.query('SELECT * FROM demo_candidates WHERE id=$1 AND account_id=$2 AND session_id=$3 FOR UPDATE',[b.candidateId,b.accountId,b.sessionId])).rows[0];
 if(!c||c.claimed_at||c.mode!==run.mode||new Date(c.expires_at).getTime()<=Date.now())throw Error('EXPIRED');
 await freshBias(db,b.accountId,c.symbol,c.request);
 if(c.mode==='TELEGRAM'){
  const approval=(await db.query("SELECT 1 FROM approvals p JOIN telegram_links l ON l.user_id=p.user_id WHERE p.id=$1 AND p.user_id=$2 AND p.account_id=$3 AND p.decision='APPROVED' AND p.consumed_at IS NOT NULL AND p.expires_at>now() AND p.proposal_version=$4 AND l.telegram_id IS NOT NULL",[c.approval_id,a.owner_id,b.accountId,a.permission_version])).rowCount;
  if(!approval)throw Error('APPROVAL_REQUIRED');
 }
 await db.query('UPDATE demo_candidates SET claimed_at=now() WHERE id=$1',[c.id]);
 await db.query("INSERT INTO audit(tenant_id,actor_id,account_id,event,data) VALUES($1,$2,$3,'DEMO_ENTRY_CLAIMED',$4)",[b.tenantId,a.owner_id,b.accountId,JSON.stringify({candidateId:c.id,mode:c.mode})]);
 return {ok:true,request:c.request};
}
