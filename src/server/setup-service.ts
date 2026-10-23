import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {TOTP,Secret} from 'otpauth';
import {digest,decrypt,token} from './security';
import {challengeUsable} from './setup-security';

// Both operations require an enclosing transaction. The lock is also used by
// scripts/bootstrap.ts, so web and CLI setup cannot create competing admins.
export async function prepareInitialAdmin(db:PoolClient,enrollment:{id:string;keyHash:string;ciphertext:string},migrate:()=>Promise<void>){
  await db.query('SELECT pg_advisory_xact_lock(908214)');
  const existing=await db.query("SELECT to_regclass('public.users') AS users");
  if(existing.rows[0].users&&(await db.query('SELECT 1 FROM users WHERE super_admin LIMIT 1')).rowCount)return false;
  await migrate();
  await db.query('DELETE FROM setup_challenges WHERE expires_at<now()');
  await db.query("INSERT INTO setup_challenges(id,setup_key_hash,secret_ciphertext,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[enrollment.id,enrollment.keyHash,enrollment.ciphertext]);
  return true;
}

type SetupResult={error:string;status:400|409}|{raw:string};
export async function finishInitialAdmin(db:PoolClient,input:{challengeId:string;username:string;passwordHash:string;otp:string;keyHash:string},timestamp=Date.now()):Promise<SetupResult>{
  await db.query('SELECT pg_advisory_xact_lock(908214)');
  if((await db.query('SELECT 1 FROM users WHERE super_admin LIMIT 1')).rowCount)return {error:'İlk admin artıq yaradılıb. Quraşdırma bağlanıb.',status:409} as const;
  const found=await db.query('SELECT * FROM setup_challenges WHERE id=$1 FOR UPDATE',[input.challengeId]);
  const challenge=found.rows[0];
  if(!challenge||!challengeUsable(challenge,input.keyHash,timestamp))return {error:'Quraşdırma vaxtı və ya kod cəhdi bitib. Yenidən başlayın.',status:400} as const;
  await db.query('UPDATE setup_challenges SET attempts=attempts+1 WHERE id=$1',[input.challengeId]);
  const totp=new TOTP({secret:Secret.fromBase32(decrypt(challenge.secret_ciphertext))});
  const delta=totp.validate({token:input.otp,timestamp,window:1});
  // Return rather than throw so the failed-attempt increment commits.
  if(delta===null)return {error:'Doğrulama kodu yanlışdır. Telefonun saatını yoxlayın.',status:400} as const;
  const user=randomUUID(),tenant=randomUUID(),raw=token();
  await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'VELA']);
  await db.query('INSERT INTO users(id,username,password_hash,super_admin,mfa_secret,default_tenant_id,mfa_last_counter) VALUES($1,$2,$3,true,$4,$5,$6)',[user,input.username,input.passwordHash,challenge.secret_ciphertext,tenant,Math.floor(timestamp/30000)+delta]);
  await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
  await db.query("INSERT INTO memberships VALUES($1,$2,'OWNER')",[tenant,user]);
  await db.query("INSERT INTO audit(tenant_id,actor_id,event) VALUES($1,$2,'INITIAL_ADMIN_CREATED')",[tenant,user]);
  await db.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '8 hours',now())",[digest(raw),user,tenant]);
  await db.query('DELETE FROM setup_challenges');
  return {raw};
}
