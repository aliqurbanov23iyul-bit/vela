import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {digest} from '../src/server/security';
import {compact,pairingCode,pairingPayload,approvalKeyboard,proposalMessage} from '../src/server/telegram';
import {telegramContext,processTelegramUpdate,type TelegramUpdate} from '../src/server/telegram-update';
test('Telegram buttons fit callback limit and messages show risk fields without secrets',()=>{
 const keyboard=approvalKeyboard(randomUUID(),randomUUID());for(const b of keyboard.inline_keyboard[0])assert.ok(Buffer.byteLength(b.callback_data)<=64);
 const text=proposalMessage('Demo',{symbol:'EURUSD',side:'BUY',entry:1.1,stop:1,take:1.3,volume:0.1,password:'SECRET'},new Date());assert.match(text,/EURUSD/);assert.match(text,/Stop-loss: 1/);assert.doesNotMatch(text,/SECRET/);
});
test('Telegram rejects group and forged callback senders',()=>{
 const data=`${compact(randomUUID())}.${compact(randomUUID())}.A`;
 assert.throws(()=>telegramContext({update_id:1,callback_query:{id:'x',from:{id:1,is_bot:false},data,message:{message_id:1,chat:{id:2,type:'private'}}}}));
 assert.throws(()=>telegramContext({update_id:1,message:{from:{id:1,is_bot:false},chat:{id:1,type:'group'},text:'/start x'}}));
});
test('Telegram deep link stays within allowed characters and binds the same one-time code',()=>{const tenant=randomUUID(),code=pairingCode(),payload=pairingPayload(tenant,code);assert.match(payload,/^[A-Za-z0-9_-]{44}$/);const u:TelegramUpdate={update_id:100,message:{from:{id:101,is_bot:false},chat:{id:101,type:'private'},text:'/start '+payload}};const context=telegramContext(u);assert.equal(context.tenant,tenant);assert.equal(context.code,code);assert.equal(telegramContext({...u,message:{...u.message!,text:`/start ${compact(tenant)}.${code}`}}).code,code);});
test('PostgreSQL Telegram pairing, retry delivery, approval isolation and single consumption',async t=>{
 const db=new PGlite();const c={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),account=randomUUID(),proposal=randomUUID(),approval=randomUUID();
 const message=(id:number,text:string):TelegramUpdate=>({update_id:id,message:{from:{id:101,is_bot:false},chat:{id:101,type:'private'},text}});
 const process=(u:TelegramUpdate)=>runRestrictedTransaction(c,telegramContext(u).tenant,x=>processTelegramUpdate(x,u,telegramContext(u)));
 try{
  await applyMigrations(c);await db.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)',[tenant,'Fixture',other,'Other']);await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[user,'telegram_fixture','hash']);await db.query("INSERT INTO memberships VALUES($1,$2,'OWNER')",[tenant,user]);await db.query("INSERT INTO telegram_links(id,tenant_id,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",[randomUUID(),tenant,user,digest('pair')]);
  const start=message(1,`/start ${compact(tenant)}.pair`);
  await t.test('pairing binds only once and queues confirmation for retries',async()=>{const r=await process(start);assert.match(r.text,/✅ VELA hesabınıza bağlandı/);assert.equal((await db.query<{telegram_id:string}>('SELECT telegram_id FROM telegram_links')).rows[0].telegram_id,'101');const retry=await process(start);assert.equal(retry.text,r.text);assert.equal((await db.query("SELECT * FROM audit WHERE event='TELEGRAM_LINKED'")).rows.length,1);});
  await t.test('delivered updates do not repeat messages',async()=>{await db.query("INSERT INTO audit(tenant_id,event,data) VALUES($1,'TELEGRAM_REPLY_DELIVERED',$2)",[tenant,JSON.stringify({updateId:'1'})]);assert.equal(await process(start),null);});
  await t.test('invalid and expired codes cannot pair',async()=>{await assert.rejects(process(message(2,`/start ${compact(tenant)}.bad`)));await assert.rejects(process(message(3,`/start ${compact(other)}.pair`)));});
  await t.test('linked status is available without a new pairing code',async()=>{assert.match((await process(message(4,`/status ${compact(tenant)}`))).text,/hesabınız bağlıdır/);});
  await db.query('INSERT INTO accounts(id,tenant_id,owner_id,label) VALUES($1,$2,$3,$4)',[account,tenant,user,'Fixture']);await db.query("INSERT INTO proposals(id,tenant_id,account_id,version,payload,expires_at) VALUES($1,$2,$3,1,'{}',now()+interval '5 minutes')",[proposal,tenant,account]);await db.query("INSERT INTO approvals(id,tenant_id,user_id,account_id,proposal_id,proposal_version,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,1,$6,now()+interval '5 minutes')",[approval,tenant,user,account,proposal,'token']);
  const callback=(id:number,scope=tenant,actor=101):TelegramUpdate=>({update_id:id,callback_query:{id:String(id),from:{id:actor,is_bot:false},data:`${compact(scope)}.${compact(approval)}.A`,message:{message_id:1,chat:{id:actor,type:'private'}}}});
  await t.test('another Telegram user and tenant cannot decide',async()=>{await assert.rejects(process(callback(5,tenant,102)));await assert.rejects(process(callback(6,other)));});
  await t.test('approval records decision and never creates a live order',async()=>{assert.match((await process(callback(7))).text,/✅ Təklif təsdiqləndi/);await assert.rejects(process(callback(8)));assert.equal((await db.query<{decision:string}>('SELECT decision FROM approvals')).rows[0].decision,'APPROVED');assert.equal((await db.query('SELECT * FROM orders')).rows.length,0);});
  await t.test('Telegram stop changes only its tenant, preserving another customer',async()=>{
   const otherAccount=randomUUID();
   await db.query('INSERT INTO accounts(id,tenant_id,owner_id,label,stopped) VALUES($1,$2,$3,$4,false)',[otherAccount,other,user,'Other account']);
   await db.query('UPDATE accounts SET stopped=false WHERE id=$1',[account]);
   await process(message(9,`/stop ${compact(tenant)}`));
   const own=(await db.query<{stopped:boolean;permission_version:number}>('SELECT stopped,permission_version FROM accounts WHERE id=$1',[account])).rows[0];
   const separate=(await db.query<{stopped:boolean;permission_version:number}>('SELECT stopped,permission_version FROM accounts WHERE id=$1',[otherAccount])).rows[0];
   assert.equal(own.stopped,true);assert.equal(own.permission_version,2);assert.equal(separate.stopped,false);assert.equal(separate.permission_version,1);
  });
 }finally{await db.close();}
});
