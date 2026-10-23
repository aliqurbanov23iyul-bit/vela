import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {marketInput,summarizeMarket,closedIndicators,type MarketInput} from '../src/server/market';
import {claimMarket} from '../src/server/market-store';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {digest} from '../src/server/security';
const now=Date.UTC(2026,9,23,12,0);
function bars(count:number,interval:number,end=now){return Array.from({length:count},(_,i)=>{const c=1.1+i*0.00001;return {time:end-(count-i)*interval,open:c,high:c+0.0002,low:c-0.0002,close:c+0.00005};});}
function fixture():MarketInput{return {accountId:randomUUID(),tenantId:randomUUID(),login:'fixture',server:'Demo',symbol:'EURUSD',brokerSymbol:'EURUSD',brokerTimeOffsetMinutes:0,observedAt:new Date(now).toISOString(),quoteAt:new Date(now).toISOString(),bid:1.102,ask:1.1021,point:0.00001,m5:bars(260,300000),h1:bars(260,3600000)};}
test('market schema rejects invalid OHLC, infinite prices, reversed spread and oversized arrays',()=>{const b=fixture();assert.ok(marketInput.safeParse(b).success);for(const v of [{...b,bid:Infinity},{...b,ask:1},{...b,m5:[...b.m5,...b.m5]},{...b,m5:b.m5.map((v,i)=>i===0?{...v,high:0.1}:v)}])assert.equal(marketInput.safeParse(v).success,false);});
test('technical summaries use closed bars and always keep execution blocked',()=>{const s=summarizeMarket(fixture(),now);assert.equal(s.dataIssues.length,0);assert.ok(s.frames.M5.ema200>0);assert.ok(s.frames.H1.rsi>=0&&s.frames.H1.rsi<=100);assert.equal(s.action,'NO_TRADE');assert.equal(s.executionAllowed,false);assert.ok(s.executionBlocks.includes('NEWS_MISSING'));});
test('stale quote, open candles, missing weekday bars and future uploads are blocked',()=>{const b=fixture();assert.ok(summarizeMarket({...b,quoteAt:new Date(now-61000).toISOString()},now).dataIssues.includes('STALE_QUOTE'));assert.throws(()=>summarizeMarket({...b,observedAt:new Date(now+61000).toISOString()},now));const open=b.m5.map(x=>({...x,time:x.time+300000}));assert.throws(()=>closedIndicators(open,now,300000));const missing=b.m5.filter((_,i)=>i!==30);assert.throws(()=>closedIndicators(missing,now,300000));assert.throws(()=>closedIndicators([...b.m5].reverse(),now,300000));});
test('weekend session gaps are accepted without inventing candles',()=>{const end=Date.UTC(2026,9,19,6);const trading=bars(360,3600000,end).filter(b=>{const d=new Date(b.time),day=d.getUTCDay(),h=d.getUTCHours();return !(day===6||day===0||day===5&&h>=20||day===1&&h<2);});assert.ok(trading.length>=220);assert.ok(closedIndicators(trading,end,3600000).atr>0);});
test('observed demo gold break permits observation only and other weekday gaps still block',()=>{const keep=(b:{time:number})=>{const h=new Date(b.time).getUTCHours();return h<20||h>=22;};const b={...fixture(),symbol:'XAUUSD' as const,server:'MetaQuotes-Demo',brokerTimeOffsetMinutes:180,m5:bars(260,300000).filter(keep),h1:bars(260,3600000).filter(keep)};const s=summarizeMarket(b,now);assert.equal(s.dataIssues.length,0);assert.equal(s.executionAllowed,false);assert.ok(s.executionBlocks.includes('BROKER_SESSION_CALENDAR_UNVERIFIED'));const wrong={...b,m5:b.m5.filter((_,i)=>i!==40)};assert.ok(summarizeMarket(wrong,now).dataIssues.includes('M5_INVALID_OR_STALE'));});
test('PostgreSQL market identity, RLS and AI budget claims',async t=>{
 const db=new PGlite(),c={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const b=fixture(),user=randomUUID(),other=randomUUID(),token='test-only-token',summary=summarizeMarket(b,now),limits={intervalMinutes:30,daily:96};
 const claim=(input=b,secret=token,s=summary,limit=limits)=>runRestrictedTransaction(c,input.tenantId,x=>claimMarket(x,input,secret,s,limit));
 try{
  await applyMigrations(c);await db.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)',[b.tenantId,'Fixture',other,'Other']);await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[user,'fixture_market','hash']);await db.query("INSERT INTO accounts(id,tenant_id,owner_id,label,broker_login,server,account_type,agent_token_hash) VALUES($1,$2,$3,'Market fixture',$4,$5,'DEMO',$6)",[b.accountId,b.tenantId,user,b.login,b.server,digest(token)]);
  await t.test('wrong bearer and tenant never save market data',async()=>{await assert.rejects(claim(b,'wrong'));await assert.rejects(claim({...b,tenantId:other}));assert.equal((await db.query('SELECT * FROM market_latest')).rows.length,0);});
  await t.test('stale data is visible but cannot trigger AI',async()=>{const r=await claim(b,token,{...summary,dataIssues:['STALE_QUOTE']});assert.equal(r.reason,'DATA_BLOCKED');assert.equal((await db.query('SELECT * FROM market_analysis_runs')).rows.length,0);});
  await t.test('daily zero disables external calls without discarding technical data',async()=>{assert.equal((await claim(b,token,summary,{...limits,daily:0})).reason,'DAILY_AI_LIMIT');});
  await t.test('valid data claims once and duplicate requests respect cooldown',async()=>{assert.ok((await claim()).id);assert.equal((await claim()).reason,'COOLDOWN');assert.equal((await db.query('SELECT * FROM market_analysis_runs')).rows.length,1);});
  await t.test('an old duplicate candle cannot generate another AI run',async()=>{await db.exec("UPDATE market_analysis_runs SET created_at=now()-interval '31 minutes'");assert.equal((await claim()).reason,'SAME_BAR');});
  await t.test('per-account daily limit applies across symbols',async()=>{assert.equal((await claim({...b,symbol:'XAUUSD'},token,summary,{...limits,daily:1})).reason,'DAILY_AI_LIMIT');});
  await t.test('older packets cannot overwrite latest quote',async()=>{const older={...b,quoteAt:new Date(now-1000).toISOString()};assert.equal((await claim(older)).reason,'OLDER_SNAPSHOT');});
  await t.test('RLS hides another tenant market and results',async()=>{const r=await runRestrictedTransaction(c,other,x=>x.query('SELECT * FROM market_latest'));assert.equal(r.rowCount,0);assert.equal((await db.query('SELECT * FROM orders')).rows.length,0);});
 }finally{await db.close();}
});
