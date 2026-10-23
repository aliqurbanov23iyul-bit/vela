import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {resolveAIConfig,preferenceInput,serviceInput} from '../src/server/ai-settings';
import {digest} from '../src/server/security';
test('AI preferences reject unknown markets, duplicates and unsupported cadence',()=>{for(const p of [{enabled:true,symbols:[],intervalMinutes:30},{enabled:true,symbols:['BTCUSD'],intervalMinutes:30},{enabled:true,symbols:['EURUSD','EURUSD'],intervalMinutes:30},{enabled:true,symbols:['EURUSD'],intervalMinutes:1}])assert.equal(preferenceInput.safeParse(p).success,false);assert.equal(serviceInput.safeParse({order:['GROQ','GROQ'],models:{GEMINI:'',GROQ:'',OPENROUTER:''},minInterval:30,dailyLimit:96}).success,false);});
test('PostgreSQL customer AI isolation and privileged service configuration',async t=>{
 const db=new PGlite(),c={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const tenant=randomUUID(),other=randomUUID(),admin=randomUUID(),customer=randomUUID(),adminToken='test-only-admin-raw',customerToken='test-only-user-raw';
 const run=<T>(scope:string,fn:(db:PoolClient)=>Promise<T>)=>runRestrictedTransaction(c,scope,fn);
 const save=(raw:string)=>'SELECT public.vela_save_ai_service($1,$2,$3,$4,$5)';
 const args=(raw:string)=>[raw,['GROQ','GEMINI'],JSON.stringify({GROQ:'fixture-model',GEMINI:'',OPENROUTER:''}),30,48];
 try{
  await applyMigrations(c);await db.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)',[tenant,'Admin',other,'Customer']);await db.query("INSERT INTO users(id,username,password_hash,super_admin,mfa_secret) VALUES($1,'admin_ai','hash',true,'fixture'),($2,'customer_ai','hash',false,NULL)",[admin,customer]);await db.query("INSERT INTO memberships VALUES($1,$2,'OWNER'),($3,$4,'OWNER')",[tenant,admin,other,customer]);await db.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '1 hour',now()),($4,$5,$6,now()+interval '1 hour',now())",[digest(adminToken),admin,tenant,digest(customerToken),customer,other]);
  await t.test('customers receive working defaults without choosing a model',async()=>{const s=await run(other,x=>resolveAIConfig(x));assert.equal(s.preference.enabled,true);assert.deepEqual(s.preference.symbols,['EURUSD','XAUUSD']);assert.equal(s.effectiveInterval,30);});
  await t.test('customer preferences are isolated by RLS',async()=>{await run(other,x=>x.query("INSERT INTO ai_preferences(tenant_id,enabled,symbols,interval_minutes) VALUES($1,false,ARRAY['EURUSD'],60)",[other]));const own=await run(other,x=>resolveAIConfig(x));assert.equal(own.preference.enabled,false);assert.equal(own.effectiveInterval,60);const separated=await run(tenant,x=>resolveAIConfig(x));assert.equal(separated.preference.enabled,true);await assert.rejects(run(tenant,x=>x.query("INSERT INTO ai_preferences(tenant_id) VALUES($1)",[other])));});
  await t.test('runtime cannot directly edit global settings, and customer or hashed sessions cannot invoke admin function',async()=>{await assert.rejects(run(other,x=>x.query('UPDATE ai_service_settings SET daily_limit=288')));await assert.rejects(run(other,x=>x.query(save(customerToken),args(customerToken))));await assert.rejects(run(tenant,x=>x.query(save(digest(adminToken)),args(digest(adminToken)))));});
  await t.test('recent verified admin can select provider/model and daily limits without storing a key',async()=>{await run(tenant,x=>x.query(save(adminToken),args(adminToken)));const resolved=await run(other,x=>resolveAIConfig(x));assert.deepEqual(resolved.service.order,['GROQ','GEMINI']);assert.equal(resolved.service.models.GROQ,'fixture-model');assert.equal(resolved.service.dailyLimit,48);assert.equal((await db.query("SELECT * FROM audit WHERE event='AI_SERVICE_UPDATED'")).rows.length,1);});
  await t.test('invalid service payloads and expired reauthentication are rejected in the database too',async()=>{await assert.rejects(run(tenant,x=>x.query(save(adminToken),[adminToken,['UNKNOWN'],'{}',30,48])));await assert.rejects(run(tenant,x=>x.query(save(adminToken),[adminToken,['GROQ'],JSON.stringify({API_KEY:'secret'}),30,48])));await db.query("UPDATE sessions SET reauthenticated_at=now()-interval '16 minutes' WHERE user_id=$1",[admin]);await assert.rejects(run(tenant,x=>x.query(save(adminToken),args(adminToken))));});
 }finally{await db.close();}
});
