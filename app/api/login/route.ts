import {NextResponse} from 'next/server';
import argon2 from 'argon2';
import {TOTP,Secret} from 'otpauth';
import {consumeLoginAttempt} from '../../../src/server/login-limit';
import {z} from 'zod';
import {pool,tenantTx} from '../../../src/server/db';
import {digest,token,decrypt} from '../../../src/server/security';
import {sameOrigin} from '../../../src/server/auth';
const input=z.object({username:z.string().min(1).max(100),password:z.string().max(256),otp:z.string().optional(),tenant:z.preprocess(v=>v===''?undefined:v,z.string().uuid().optional())});

export async function POST(req:Request){
  try{
    sameOrigin(req);
    const body=input.parse(await req.json());
    const limit=await consumeLoginAttempt(pool,body.username);
    if(!limit.allowed)return NextResponse.json({error:'Çok fazla deneme. Daha sonra tekrar deneyin.'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
    const {rows}=await pool.query('SELECT * FROM users WHERE username=$1 AND NOT disabled',[body.username]);
    const user=rows[0];
    if(!user||!await argon2.verify(user.password_hash,body.password))throw Error('LOGIN');
    let counter:number|undefined;
    if(user.super_admin){
      if(!user.mfa_secret||!body.otp)throw Error('LOGIN');
      const totp=new TOTP({secret:Secret.fromBase32(decrypt(user.mfa_secret))});
      const timestamp=Date.now(),delta=totp.validate({token:body.otp,timestamp,window:1});
      if(delta===null)throw Error('LOGIN');
      counter=Math.floor(timestamp/30000)+delta;
    }
    const tenant=body.tenant??user.default_tenant_id;
    if(!tenant)throw Error('LOGIN');
    const raw=token();
    await tenantTx(tenant,async db=>{
      const membership=await db.query('SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND NOT t.suspended',[user.id,tenant]);
      if(!membership.rowCount)throw Error('LOGIN');
      if(counter!==undefined){
        const consumed=await db.query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1 AND (mfa_last_counter IS NULL OR mfa_last_counter<$2) RETURNING id',[user.id,counter]);
        if(!consumed.rowCount)throw Error('LOGIN');
      }
      await db.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '8 hours',now())",[digest(raw),user.id,tenant]);
    });
    const res=NextResponse.json({ok:true});
    res.cookies.set('session',raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:28800});
    return res;
  }catch{return NextResponse.json({error:'Giriş doğrulanamadı. Bilgilerinizi ve güncel doğrulama kodunu kontrol edin.'},{status:401});}
}

