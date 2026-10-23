import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {digest} from '../src/server/security';
import {controlDemo,prepareDemo,claimDemo,brokerRequest,demoDeal} from '../src/server/demo-control';
import {processTelegramUpdate,telegramContext} from '../src/server/telegram-update';
import {compact} from '../src/server/telegram';

test('demo requests reject missing protection and unauthorized request flags',()=>{
 assert.equal(brokerRequest.safeParse({}).success,false);
 assert.equal(demoDeal.safeParse({ticket:'-1'}).success,false);
});
test('PostgreSQL website demo control, mode selection, Telegram grants and isolation',async t=>{
 const db=new PGlite();const c={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),account=randomUUID(),token='demo-test-agent-token';
 const tx=<T>(fn:(db:PoolClient)=>Promise<T>)=>runRestrictedTransaction(c,tenant,fn);
 const identity={tenantId:tenant,accountId:account,login:'123',server:'Demo'};
 const barAt=new Date(Math.floor(Date.now()/300000)*300000-300000).toISOString();
 const request=(session:string)=>({action:1 as const,symbol:'EURUSD',volume:.01,type:0 as const,price:1.1,sl:1.09,tp:1.12,deviation:10 as const,magic:2601023 as const,comment:'VELA-DEMO-'+session.slice(0,8),type_time:0 as const,type_filling:1 as const});
 let run:any,candidate:any;
 const prepare=(session=run.sessionId)=>tx(x=>prepareDemo(x,{...identity,operation:'prepare',sessionId:session,symbol:'EURUSD',barAt,request:request(session)},token));
 const claim=(id=candidate.id,session=run.sessionId)=>tx(x=>claimDemo(x,{...identity,operation:'claim',sessionId:session,candidateId:id},token));
 try{
  await applyMigrations(c);
  await db.query('INSERT INTO tenants(id,name) VALUES($1,\'Demo\'),($2,\'Other\')',[tenant,other]);
  await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,\'demo-owner\',\'hash\')',[user]);
  await db.query("INSERT INTO memberships VALUES($1,$2,'OWNER')",[tenant,user]);
  await db.query("INSERT INTO accounts(id,tenant_id,owner_id,label,account_type,broker_login,server,agent_token_hash,heartbeat,snapshot) VALUES($1,$2,$3,'Demo','DEMO','123','Demo',$4,now(),'{\"demoProtocol\":1}')",[account,tenant,user,digest(token)]);
  await db.query("INSERT INTO market_latest(tenant_id,account_id,symbol,broker_symbol,quote_at,observed_at,summary) VALUES($1,$2,'EURUSD','EURUSD',now(),now(),'{\"dataIssues\":[]}')",[tenant,account]);
  await db.query("INSERT INTO market_analysis_runs(id,tenant_id,account_id,symbol,bar_at,status,result) VALUES($1,$2,$3,'EURUSD',$4,'COMPLETED',$5)",[randomUUID(),tenant,account,barAt,JSON.stringify({bias:'BUY',newsAssessment:{summary:'Official news'},expiresAt:new Date(Date.now()+180000).toISOString()})]);
  await t.test('only the account owner with a recent compatible demo connector can start',async()=>{
   await assert.rejects(tx(x=>controlDemo(x,randomUUID(),account,'start','AUTO')),/FORBIDDEN/);
   await db.query("UPDATE accounts SET account_type='REAL' WHERE id=$1",[account]);await assert.rejects(tx(x=>controlDemo(x,user,account,'start','AUTO')),/DEMO_ONLY/);
   await db.query("UPDATE accounts SET account_type='DEMO',snapshot='{}' WHERE id=$1",[account]);await assert.rejects(tx(x=>controlDemo(x,user,account,'start','AUTO')),/CONNECTOR/);
   await db.query("UPDATE accounts SET snapshot='{\"demoProtocol\":1}' WHERE id=$1",[account]);
  });
  await t.test('Telegram mode requires a linked owner, AUTO works without Telegram',async()=>{
   await assert.rejects(tx(x=>controlDemo(x,user,account,'start','TELEGRAM')),/TELEGRAM/);
   run=await tx(x=>controlDemo(x,user,account,'start','AUTO'));assert.equal(run.mode,'AUTO');
   assert.equal((await tx(x=>controlDemo(x,user,account,'start','AUTO')))?.sessionId,run.sessionId);
   candidate=await prepare();assert.equal(candidate.state,'APPROVED');assert.equal(candidate.notification,null);
  });
  await t.test('another tenant and forged connector token cannot prepare a candidate',async()=>{
   await assert.rejects(runRestrictedTransaction(c,other,x=>prepareDemo(x,{...identity,tenantId:other,operation:'prepare',sessionId:run.sessionId,symbol:'EURUSD',barAt,request:request(run.sessionId)},token)),/AUTH/);
   await assert.rejects(tx(x=>prepareDemo(x,{...identity,operation:'prepare',sessionId:run.sessionId,symbol:'EURUSD',barAt,request:request(run.sessionId)},'wrong')),/AUTH/);
  });
  await t.test('AUTO grant is bound to the exact request and single consumption',async()=>{
   const grant=await claim();assert.deepEqual(grant.request,request(run.sessionId));await assert.rejects(claim(),/EXPIRED/);
  });
  await db.query('INSERT INTO telegram_links(id,tenant_id,user_id,telegram_id) VALUES($1,$2,$3,\'101\')',[randomUUID(),tenant,user]);
  await t.test('Telegram candidate is sent once and cannot be claimed before approval',async()=>{
   run=await tx(x=>controlDemo(x,user,account,'start','TELEGRAM'));candidate=await prepare();assert.equal(candidate.state,'PENDING');assert.ok(candidate.notification);
   assert.equal((await prepare()).notification,null);await assert.rejects(claim(),/APPROVAL_REQUIRED/);
  });
  await t.test('linked owner approves and candidate executes only once',async()=>{
   const approval=(await db.query<{approval_id:string}>('SELECT approval_id FROM demo_candidates WHERE id=$1',[candidate.id])).rows[0].approval_id;
   const u={update_id:123,callback_query:{id:'123',from:{id:101,is_bot:false},data:`${compact(tenant)}.${compact(approval)}.A`,message:{message_id:1,chat:{id:101,type:'private'}}}};
   assert.match((await tx(x=>processTelegramUpdate(x,u,telegramContext(u)))).text,/Demo təklifi təsdiqləndi/);
   assert.equal((await prepare()).state,'APPROVED');await claim();await assert.rejects(claim(),/EXPIRED/);
  });
  await t.test('stop invalidates in-flight candidates and prevents restart from old session',async()=>{
   await tx(x=>controlDemo(x,user,account,'stop','TELEGRAM'));await assert.rejects(prepare(),/STOPPED/);await assert.rejects(claim(),/STOPPED/);
   const previous=run.sessionId;run=await tx(x=>controlDemo(x,user,account,'start','AUTO'));assert.notEqual(run.sessionId,previous);await assert.rejects(prepare(previous),/STOPPED/);
  });
  await t.test('AI pause and expired news-aware AI observations block even AUTO',async()=>{
   await db.query('INSERT INTO ai_preferences(tenant_id,enabled) VALUES($1,false)',[tenant]);await assert.rejects(prepare(),/STALE_SIGNAL/);
   await db.query('UPDATE ai_preferences SET enabled=true');await db.query("UPDATE market_analysis_runs SET result=jsonb_set(result,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text))");await assert.rejects(prepare(),/STALE_SIGNAL/);
  });
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,0);
 }finally{await db.close();}
});
