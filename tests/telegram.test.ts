import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {digest} from '../src/server/security';
import {compact,pairingCode,pairingPayload} from '../src/server/telegram';
import {telegramContext,processTelegramUpdate,processTelegramCommand,type TelegramUpdate} from '../src/server/telegram-update';
test('Telegram account linking payload is compact and single use',()=>{const tenant=randomUUID(),code=pairingCode(),payload=pairingPayload(tenant,code);assert.match(payload,/^[A-Za-z0-9_-]{44}$/);const u:TelegramUpdate={update_id:7,message:{from:{id:101,is_bot:false},chat:{id:101,type:'private'},text:'/start '+payload}};const c=telegramContext(u);assert.equal(c?.tenant,tenant);assert.equal(c?.code,code);assert.equal(telegramContext({...u,message:{...u.message!,chat:{id:101,type:'group'}}}),null);assert.equal(telegramContext({...u,callback_query:{id:'x',from:{id:101,is_bot:false},data:'x'}}),null);});
test('Telegram linking is tenant scoped, idempotent and sends no approval controls',async()=>{
 const pg=new PGlite();const c={query:async(sql:string,values?:unknown[])=>{const r=values?await pg.query(sql,values):(await pg.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),code=pairingCode();
 try{await applyMigrations(c);await pg.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)',[tenant,'Tenant',other,'Other']);await pg.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[user,'safe_fixture','hash']);await pg.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'OWNER')",[tenant,user]);await pg.query("INSERT INTO telegram_links(id,tenant_id,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",[randomUUID(),tenant,user,digest(code)]);
 const u:TelegramUpdate={update_id:1,message:{from:{id:404,is_bot:false},chat:{id:404,type:'private'},text:'/start '+compact(tenant)+code}};const context=telegramContext(u)!;
 const result=await runRestrictedTransaction(c,tenant,db=>processTelegramUpdate(db,u,context)) as {text:string}|null;assert.match(result!.text,/hesabınız bağlandı/i);assert.match(result!.text,/ticarət əmri göndərmir/i);assert.equal((await pg.query<{telegram_id:string}>('SELECT telegram_id FROM telegram_links WHERE user_id=$1',[user])).rows[0].telegram_id,'404');
 const duplicate=await runRestrictedTransaction(c,tenant,db=>processTelegramUpdate(db,u,context));assert.equal(duplicate,null);
 assert.equal((await pg.query<{user_id:string}>('SELECT tenant_id,user_id FROM public.resolve_telegram_chat($1)',['404'])).rows[0].user_id,user);
 const command=(update_id:number,text:string)=>({update_id,message:{from:{id:404,is_bot:false},chat:{id:404,type:'private'},text}} as TelegramUpdate);
 const paused=await runRestrictedTransaction(c,tenant,db=>processTelegramCommand(db,command(2,'/pause'),tenant,user)) as string;assert.match(paused,/dayandırıldı/i);assert.equal((await pg.query<{paused:boolean}>('SELECT paused FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[tenant,user])).rows[0].paused,true);
 await runRestrictedTransaction(c,tenant,db=>processTelegramCommand(db,command(3,'/resume'),tenant,user));assert.equal((await pg.query<{paused:boolean}>('SELECT paused FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[tenant,user])).rows[0].paused,false);
 const unlinked=await runRestrictedTransaction(c,tenant,db=>processTelegramCommand(db,command(4,'/unlink'),tenant,user)) as string;assert.match(unlinked,/kəsildi/i);assert.equal((await pg.query('SELECT 1 FROM telegram_links WHERE tenant_id=$1 AND user_id=$2',[tenant,user])).rowCount,0);assert.equal((await pg.query<{enabled:boolean;paused:boolean}>('SELECT enabled,paused FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[tenant,user])).rows[0].enabled,false);
 const invalid:TelegramUpdate={...u,update_id:5,message:{...u.message!,text:'/start '+compact(other)+code}};const invalidContext=telegramContext(invalid)!;await assert.rejects(runRestrictedTransaction(c,other,db=>processTelegramUpdate(db,invalid,invalidContext)));
 }finally{await pg.close();}
});
test('Telegram pairing tokens are cryptographically unpredictable',()=>{assert.notEqual(pairingCode(),pairingCode());});




