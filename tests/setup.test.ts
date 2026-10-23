import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {TOTP} from 'otpauth';
import argon2 from 'argon2';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {prepareInitialAdmin,finishInitialAdmin} from '../src/server/setup-service';
import {encrypt,digest} from '../src/server/security';
import {validSetupToken,challengeUsable} from '../src/server/setup-security';
import {POST} from '../app/api/setup/route';
import {runRestrictedTransaction} from '../src/server/db';

test('setup token is disabled by default and must match a strong configured value',()=>{
  assert.equal(validSetupToken('anything',''),false);
  assert.equal(validSetupToken('short','short'),false);
  assert.equal(validSetupToken('a'.repeat(64),'b'.repeat(64)),false);
  assert.equal(validSetupToken('a'.repeat(64),'a'.repeat(64)),true);
});
test('setup challenge rejects expired, exhausted and mismatched bindings',()=>{
  const c={attempts:0,expires_at:new Date(200),setup_key_hash:'hash'};
  assert.equal(challengeUsable(c,'hash',100),true);
  assert.equal(challengeUsable(c,'hash',200),false);
  assert.equal(challengeUsable({...c,attempts:5},'hash',100),false);
  assert.equal(challengeUsable(c,'other',100),false);
});
test('setup endpoint rejects missing token before accessing the database',async()=>{
  const r=await POST(new Request('https://example.test/api/setup',{method:'POST',body:'{}'}));
  assert.equal(r.status,403);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('embedded PostgreSQL: initial admin, migration rollback, MFA limits and runtime isolation',async t=>{
  process.env.SECRET_KEY_HEX='cd'.repeat(32);
  const db=new PGlite();
  const client={query:async(sql:string,values?:unknown[])=>{
    const result=values?await db.query(sql,values):(await db.exec(sql)).at(-1);
    return {...result,rowCount:result?.rows.length||result?.affectedRows||0};
  }} as unknown as PoolClient;
  async function tx<T>(fn:()=>Promise<T>){await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}}
  const keyHash=digest('fixture-setup-token'),enrollment=new TOTP({issuer:'VELA',label:'test'}),id=randomUUID();
  const data={id,keyHash,ciphertext:encrypt(enrollment.secret.base32)};
  const passwordHash=await argon2.hash('test-only-long-password',{type:argon2.argon2id});
  try{
    await t.test('all migrations apply atomically on an empty database',async()=>{
      assert.equal(await tx(()=>prepareInitialAdmin(client,data,()=>applyMigrations(client))),true);
      assert.equal((await db.query('SELECT * FROM schema_migrations')).rows.length,10);
      await tx(()=>applyMigrations(client)); // ledger makes reruns harmless
    });
    await t.test('five wrong codes persist and block a later correct code',async()=>{
      const input={challengeId:id,username:'fixture',passwordHash,keyHash,otp:'not-a-code'};
      for(let i=0;i<5;i++)assert.ok('error' in await tx(()=>finishInitialAdmin(client,input)));
      assert.equal((await db.query<{attempts:number}>('SELECT attempts FROM setup_challenges WHERE id=$1',[id])).rows[0].attempts,5);
      assert.ok('error' in await tx(()=>finishInitialAdmin(client,{...input,otp:enrollment.generate()})));
      assert.equal((await db.query('SELECT * FROM users')).rows.length,0);
    });
    const second=randomUUID();
    await t.test('expired challenge cannot create an admin',async()=>{
      await tx(()=>prepareInitialAdmin(client,{...data,id:second},()=>applyMigrations(client)));
      await db.query("UPDATE setup_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[second]);
      assert.ok('error' in await tx(()=>finishInitialAdmin(client,{challengeId:second,username:'fixture',passwordHash,keyHash,otp:enrollment.generate()})));
    });
    const third=randomUUID();let tenant:string,user:string;
    await t.test('an insert failure rolls back the tenant and challenge attempt',async()=>{
      await tx(()=>prepareInitialAdmin(client,{...data,id:third},()=>applyMigrations(client)));
      const existing=randomUUID();
      await db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[existing,'fixture',passwordHash]);
      await assert.rejects(tx(()=>finishInitialAdmin(client,{challengeId:third,username:'fixture',passwordHash,keyHash,otp:enrollment.generate()})));
      assert.equal((await db.query('SELECT * FROM tenants')).rows.length,0);
      assert.equal((await db.query<{attempts:number}>('SELECT attempts FROM setup_challenges WHERE id=$1',[third])).rows[0].attempts,0);
      await db.query('DELETE FROM users WHERE id=$1',[existing]);
    });
    await t.test('MFA-proven enrollment creates one admin, owner membership, audit and hash-only session',async()=>{
      const result=await tx(()=>finishInitialAdmin(client,{challengeId:third,username:'fixture',passwordHash,keyHash,otp:enrollment.generate()}));
      assert.ok('raw' in result);
      const u=(await db.query<{id:string;default_tenant_id:string;password_hash:string;mfa_secret:string}>('SELECT * FROM users')).rows[0];tenant=u.default_tenant_id;user=u.id;
      assert.ok(await argon2.verify(u.password_hash,'test-only-long-password'));
      assert.notEqual(u.mfa_secret,enrollment.secret.base32);
      assert.equal((await db.query('SELECT * FROM memberships')).rows.length,1);
      assert.equal((await db.query('SELECT * FROM audit')).rows.length,1);
      const session=(await db.query<{token_hash:string}>('SELECT token_hash FROM sessions')).rows[0];
      assert.notEqual(session.token_hash,result.raw);assert.equal(session.token_hash,digest(result.raw!));
      assert.equal((await db.query('SELECT * FROM setup_challenges')).rows.length,0);
    });
    await t.test('completed setup closes both prepare and finish and never reruns migrations',async()=>{
      assert.equal(await tx(()=>prepareInitialAdmin(client,data,async()=>{throw Error('Must not run');})),false);
      const result=await tx(()=>finishInitialAdmin(client,{challengeId:third,username:'second',passwordHash,keyHash,otp:enrollment.generate()}));
      assert.ok('error' in result);assert.equal((await db.query('SELECT * FROM users')).rows.length,1);
    });
    await t.test('runtime role cannot read enrollment material or change admin grants',async()=>{
      await db.exec('SET ROLE forex_app');
      await assert.rejects(db.query('SELECT * FROM setup_challenges'));
      await assert.rejects(db.query('UPDATE users SET super_admin=true'));
      await assert.rejects(db.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[randomUUID(),'forbidden','forbidden']));
      await db.exec('RESET ROLE');
    });
    await t.test('MFA counter cannot be reused and tenant scope remains enforced',async()=>{
      await db.exec('SET ROLE forex_app');
      const current=(await db.query<{mfa_last_counter:number}>('SELECT mfa_last_counter FROM users WHERE id=$1',[user!])).rows[0].mfa_last_counter;
      assert.equal((await db.query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1 AND (mfa_last_counter IS NULL OR mfa_last_counter<$2) RETURNING id',[user!,current])).rows.length,0);
      assert.equal((await db.query('SELECT * FROM memberships')).rows.length,0);
      await tx(async()=>{await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant!]);assert.equal((await db.query('SELECT * FROM memberships')).rows.length,1);});
      await db.exec('RESET ROLE');
    });
    await t.test('application transaction enforces runtime role even from an owner connection',async()=>{
      await runRestrictedTransaction(client,randomUUID(),async c=>{
        assert.equal((await c.query('SELECT current_user AS role')).rows[0].role,'forex_app');
        assert.equal((await c.query('SELECT * FROM memberships')).rowCount,0);
      });
      await runRestrictedTransaction(client,tenant!,async c=>{
        assert.equal((await c.query('SELECT * FROM memberships')).rowCount,1);
      });
      assert.equal((await db.query<{role:string}>('SELECT current_user AS role')).rows[0].role,'postgres');
    });
  }finally{await db.close();}
});
