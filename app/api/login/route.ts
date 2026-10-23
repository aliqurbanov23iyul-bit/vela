import {NextResponse} from 'next/server';
import argon2 from 'argon2';
import {TOTP,Secret} from 'otpauth';
import {consumeLoginAttempt} from '../../../src/server/login-limit';
import {z} from 'zod';
import {pool,tenantTx} from '../../../src/server/db';
import {digest,token,decrypt} from '../../../src/server/security';
import {sameOrigin} from '../../../src/server/auth';
export async function POST(req:Request){try{sameOrigin(req);const body=z.object({username:z.string().min(1).max(100),password:z.string().max(256),otp:z.string().optional(),tenant:z.string().uuid()}).parse(await req.json());const limit=await consumeLoginAttempt(pool,body.username);if(!limit.allowed)return NextResponse.json({error:'Çok fazla deneme. Daha sonra tekrar deneyin.'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});const {rows}=await pool.query('SELECT * FROM users WHERE username=$1 AND NOT disabled',[body.username]);const u=rows[0];if(!u||!await argon2.verify(u.password_hash,body.password))throw Error('LOGIN');if(u.super_admin){if(!u.mfa_secret||!body.otp)throw Error('LOGIN');const totp=new TOTP({secret:Secret.fromBase32(decrypt(u.mfa_secret))});if(totp.validate({token:body.otp,window:1})===null)throw Error('LOGIN');}await tenantTx(body.tenant,async db=>{const m=await db.query('SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND NOT t.suspended',[u.id,body.tenant]);if(!m.rowCount)throw Error('LOGIN');});const raw=token();await pool.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,reauthenticated_at) VALUES($1,$2,$3,now()+interval '8 hours',now())",[digest(raw),u.id,body.tenant]);const res=NextResponse.json({ok:true});res.cookies.set('session',raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:28800});return res;}catch{return NextResponse.json({error:'Giriş doğrulanamadı veya kimlik servisine erişilemiyor.'},{status:401});}}

