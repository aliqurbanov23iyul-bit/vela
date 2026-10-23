import {randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {TOTP} from 'otpauth';
import {Pool} from 'pg';
import {encrypt} from '../src/server/security';
const username=process.env.BOOTSTRAP_USERNAME,password=process.env.BOOTSTRAP_PASSWORD;
if(!username||!password||password.length<16)throw Error('Set BOOTSTRAP_USERNAME and BOOTSTRAP_PASSWORD (16+ chars), never command-line password arguments.');
const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const user=randomUUID(),tenant=randomUUID(),totp=new TOTP({issuer:'Forex AI',label:username});
const c=await db.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(908214)");if((await c.query('SELECT 1 FROM users WHERE super_admin')).rowCount)throw Error('Already initialized');await c.query('INSERT INTO tenants VALUES($1,$2,false)',[tenant,'Ana organizasyon']);await c.query('INSERT INTO users(id,username,password_hash,super_admin,mfa_secret,default_tenant_id) VALUES($1,$2,$3,true,$4,$5)',[user,username,await argon2.hash(password,{type:argon2.argon2id}),encrypt(totp.secret.base32),tenant]);await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);await c.query("INSERT INTO memberships VALUES($1,$2,'OWNER')",[tenant,user]);await c.query('COMMIT');console.log('Tenant:',tenant);console.log('Enroll once in authenticator, keep private:',totp.toString());}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}

