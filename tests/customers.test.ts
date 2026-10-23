import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {TOTP} from 'otpauth';
import argon2 from 'argon2';
import {applyMigrations} from '../src/server/migrations';
import {prepareInitialAdmin,finishInitialAdmin} from '../src/server/setup-service';
import {runRestrictedTransaction} from '../src/server/db';
import {digest,encrypt,token} from '../src/server/security';

test('embedded PostgreSQL customer management authorization and data isolation',async t=>{
  process.env.SECRET_KEY_HEX='ef'.repeat(32);const db=new PGlite();
  const client={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
  async function tx<T>(fn:()=>Promise<T>){await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
  async function runtime(sql:string,values:unknown[]){return runRestrictedTransaction(client,undefined,c=>c.query(sql,values));}
  const enrollment=new TOTP({issuer:'VELA',label:'fixture'}),challengeId=randomUUID(),keyHash=digest('fixture-setup');
  const hash=await argon2.hash('fixture-customer-password',{type:argon2.argon2id});
  let adminToken='',customerId='',customerTenant='',brokerAccount='';
  try{
    await tx(()=>prepareInitialAdmin(client,{id:challengeId,keyHash,ciphertext:encrypt(enrollment.secret.base32)},()=>applyMigrations(client)));
    const initialized=await tx(()=>finishInitialAdmin(client,{challengeId,username:'fixture_admin',passwordHash:hash,otp:enrollment.generate(),keyHash}));
    assert.ok('raw' in initialized);adminToken=initialized.raw;

    await t.test('anonymous session cannot create or list customers',async()=>{
      await assert.rejects(runtime('SELECT vela_create_customer($1,$2,$3,$4)',['invalid','customer_one',hash,'One']));
      await assert.rejects(runtime('SELECT vela_list_customers($1)',['invalid']));
    });
    await t.test('admin creates an isolated customer with no admin or live trading privilege',async()=>{
      const r=await runtime('SELECT vela_create_customer($1,$2,$3,$4) AS id',[adminToken,'customer_one',hash,'Müşteri Bir']);customerId=r.rows[0].id;
      const u=(await db.query<{id:string;default_tenant_id:string;password_hash:string;super_admin:boolean}>('SELECT * FROM users WHERE id=$1',[customerId])).rows[0];
      customerTenant=u.default_tenant_id;assert.equal(u.super_admin,false);assert.ok(await argon2.verify(u.password_hash,'fixture-customer-password'));
      assert.equal((await db.query('SELECT * FROM memberships WHERE user_id=$1 AND tenant_id=$2',[customerId,customerTenant])).rows.length,1);
      assert.equal((await db.query('SELECT * FROM accounts WHERE tenant_id=$1',[customerTenant])).rows.length,0);
    });
    await t.test('duplicate username rolls back tenant and grant creation',async()=>{
      const before=(await db.query('SELECT * FROM tenants')).rows.length;
      await assert.rejects(runtime('SELECT vela_create_customer($1,$2,$3,$4)',[adminToken,'customer_one',hash,'Duplicate']));
      assert.equal((await db.query('SELECT * FROM tenants')).rows.length,before);
      assert.equal((await db.query('SELECT * FROM admin_tenant_grants')).rows.length,1);
    });
    await t.test('customer session and leaked token hash cannot act as admin',async()=>{
      const customerToken=token();await db.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '1 hour',now())",[digest(customerToken),customerId,customerTenant]);
      await assert.rejects(runtime('SELECT vela_list_customers($1)',[customerToken]));
      await assert.rejects(runtime('SELECT vela_create_customer($1,$2,$3,$4)',[customerToken,'forbidden_user',hash,'']));
      await assert.rejects(runtime('SELECT vela_list_customers($1)',[digest(adminToken)]));
      await assert.rejects(runtime('SELECT * FROM admin_tenant_grants',[]));
    });
    await t.test('profile exposes snapshot fields and positions without connection/password secrets',async()=>{
      brokerAccount=randomUUID();
      const snapshot={balance:500,equity:512.5,margin:20,freeMargin:492.5,password:'never-expose-snapshot-secret',positions:[{ticket:10,symbol:'EURUSD',type:0,volume:.01,price_open:1.1,profit:12.5,swap:-.1,password:'never-expose-position-secret'}],orders:[{ticket:11,symbol:'GBPUSD',type:2,volume_current:.01,price_open:1.2,token:'never-expose-order-secret'}]};
      await db.query("INSERT INTO accounts(id,tenant_id,owner_id,label,stopped,currency,snapshot,heartbeat,secret_ciphertext,agent_token_hash) VALUES($1,$2,$3,'Fixture broker',false,'USD',$4,now(),'never-expose-broker-secret','never-expose-agent-secret')",[brokerAccount,customerTenant,customerId,snapshot]);
      const r=await runtime('SELECT vela_customer_detail($1,$2) AS data',[adminToken,customerId]);const profile=r.rows[0].data;
      assert.equal(profile.accounts[0].balance,500);assert.equal(profile.accounts[0].positions[0].profit,12.5);assert.equal(profile.accounts[0].orders[0].ticket,11);
      const serialized=JSON.stringify(profile);assert.ok(!serialized.includes('never-expose'));assert.ok(!serialized.includes('password_hash'));assert.ok(!serialized.includes('mfa_secret'));
      const list=await runtime('SELECT vela_list_customers($1,$2,$3) AS data',[adminToken,'customer',0]);assert.equal(list.rows[0].data.total,1);assert.equal(list.rows[0].data.customers[0].accountCount,1);
    });
    await t.test('a different super admin has no access without a customer grant',async()=>{
      const other=randomUUID(),org=randomUUID(),raw=token();
      await db.query("INSERT INTO tenants(id,name) VALUES($1,'Other admin')",[org]);
      await db.query("INSERT INTO users(id,username,password_hash,super_admin,mfa_secret,default_tenant_id) VALUES($1,'other_admin',$2,true,$3,$4)",[other,hash,encrypt(enrollment.secret.base32),org]);
      await db.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '1 hour',now())",[digest(raw),other,org]);
      const list=await runtime('SELECT vela_list_customers($1) AS data',[raw]);assert.equal(list.rows[0].data.total,0);
      await assert.rejects(runtime('SELECT vela_customer_detail($1,$2)',[raw,customerId]));
      await assert.rejects(runtime('SELECT vela_set_customer_access($1,$2,false)',[raw,customerId]));
    });
    await t.test('old admin sessions may read but must reauthenticate to create or suspend',async()=>{
      await db.query("UPDATE sessions SET reauthenticated_at=now()-interval '16 minutes' WHERE token_hash=$1",[digest(adminToken)]);
      assert.equal((await runtime('SELECT vela_list_customers($1) AS data',[adminToken])).rows[0].data.total,1);
      await assert.rejects(runtime('SELECT vela_create_customer($1,$2,$3,$4)',[adminToken,'expired_auth',hash,'']));
      await assert.rejects(runtime('SELECT vela_set_customer_access($1,$2,false)',[adminToken,customerId]));
      await db.query('UPDATE sessions SET reauthenticated_at=now() WHERE token_hash=$1',[digest(adminToken)]);
    });
    await t.test('suspension revokes customer sessions and queued entries without closing positions',async()=>{
      const proposal=randomUUID();await db.query("INSERT INTO proposals(id,tenant_id,account_id,version,payload,expires_at) VALUES($1,$2,$3,1,'{}',now()+interval '1 hour')",[proposal,customerTenant,brokerAccount]);
      await db.query("INSERT INTO orders(id,tenant_id,account_id,proposal_id,state) VALUES($1,$2,$3,$4,'CREATED')",[randomUUID(),customerTenant,brokerAccount,proposal]);
      await runtime('SELECT vela_set_customer_access($1,$2,false)',[adminToken,customerId]);
      assert.equal((await db.query<{disabled:boolean}>('SELECT disabled FROM users WHERE id=$1',[customerId])).rows[0].disabled,true);
      assert.equal((await db.query('SELECT * FROM sessions WHERE user_id=$1',[customerId])).rows.length,0);
      assert.equal((await db.query<{state:string}>('SELECT state FROM orders WHERE tenant_id=$1',[customerTenant])).rows[0].state,'BLOCKED');
      const account=(await db.query<{stopped:boolean;live_enabled:boolean;snapshot:{positions:unknown[]}}>('SELECT * FROM accounts WHERE id=$1',[brokerAccount])).rows[0];assert.equal(account.stopped,true);assert.equal(account.live_enabled,false);assert.equal(account.snapshot.positions.length,1);
      await runtime('SELECT vela_set_customer_access($1,$2,true)',[adminToken,customerId]);
      assert.equal((await db.query<{disabled:boolean}>('SELECT disabled FROM users WHERE id=$1',[customerId])).rows[0].disabled,false);
      assert.equal((await db.query<{stopped:boolean}>('SELECT stopped FROM accounts WHERE id=$1',[brokerAccount])).rows[0].stopped,true);
    });
    await t.test('admin profile access and account changes produce tenant audit entries',async()=>{
      const audit=await db.query<{event:string}>('SELECT event FROM audit WHERE tenant_id=$1',[customerTenant]);
      for(const name of ['CUSTOMER_CREATED','ADMIN_CUSTOMER_PROFILE_ACCESS','CUSTOMER_SUSPENDED','CUSTOMER_ENABLED'])assert.ok(audit.rows.some(row=>row.event===name));
    });
  }finally{await db.close();}
});
