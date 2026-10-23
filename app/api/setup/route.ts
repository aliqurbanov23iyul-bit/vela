import {NextResponse} from 'next/server';
import {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {TOTP} from 'otpauth';
import QRCode from 'qrcode';
import {z} from 'zod';
import {sameOrigin} from '../../../src/server/auth';
import {applyMigrations} from '../../../src/server/migrations';
import {encrypt,digest} from '../../../src/server/security';
import {validSetupToken,setupEncryptionConfigured} from '../../../src/server/setup-security';
import {prepareInitialAdmin,finishInitialAdmin} from '../../../src/server/setup-service';

export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('prepare')}),
  z.object({action:z.literal('finish'),challengeId:z.string().uuid(),username:z.string().regex(/^[a-zA-Z0-9_.-]{3,64}$/),password:z.string().min(8).max(256),otp:z.string().regex(/^\d{6}$/)})
]);
function response(error:string,status:number){return NextResponse.json({error},{status,headers});}
async function transaction<T>(db:PoolClient,fn:()=>Promise<T>){
  await db.query('BEGIN');
  try{await db.query("SET LOCAL lock_timeout='5s'");const value=await fn();await db.query('COMMIT');return value;}
  catch(e){await db.query('ROLLBACK');throw e;}
}

export async function POST(req:Request){
  const setupToken=req.headers.get('x-setup-token')??'';
  if(!validSetupToken(setupToken))return response('Quraşdırma kodu yanlışdır və ya quraşdırma bağlıdır.',403);
  try{sameOrigin(req);}catch{return response('APP_ORIGIN saytın HTTPS ünvanı ilə eyni olmalıdır.',403);}
  if(!setupEncryptionConfigured())return response('Vercel-də SECRET_KEY_HEX 64 simvolluq hex açarı olaraq qurulmalıdır.',503);
  const parsed=input.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return response('İstifadəçi adı, ən azı 8 simvolluq şifrə və 6 rəqəmli kodu yoxlayın.',400);
  const connectionString=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
  if(!connectionString)return response('Veritabanı bağlantısı qurulmayıb.',503);
  const admin=new Pool({connectionString,max:1,connectionTimeoutMillis:8000,query_timeout:30000});
  let db:PoolClient|undefined;
  try{
    db=await admin.connect();const c=db;
    if(parsed.data.action==='prepare'){
      const enrollment=new TOTP({issuer:'VELA',label:'Administrator'});
      const qr=await QRCode.toDataURL(enrollment.toString(),{width:224,margin:2,errorCorrectionLevel:'M'});
      const challengeId=randomUUID();
      const open=await transaction(c,()=>prepareInitialAdmin(c,{id:challengeId,keyHash:digest(setupToken),ciphertext:encrypt(enrollment.secret.base32)},()=>applyMigrations(c)));
      if(!open)return response('İlk admin artıq yaradılıb. Quraşdırma bağlanıb.',409);
      return NextResponse.json({challengeId,qr,manualKey:enrollment.secret.base32,expiresInSeconds:600},{headers});
    }
    const b=parsed.data;
    const hash=await argon2.hash(b.password,{type:argon2.argon2id});
    const result=await transaction(c,()=>finishInitialAdmin(c,{challengeId:b.challengeId,username:b.username,passwordHash:hash,otp:b.otp,keyHash:digest(setupToken)}));
    if('error' in result)return response(result.error,result.status);
    const res=NextResponse.json({ok:true},{headers});
    res.cookies.set('session',result.raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:28800});
    return res;
  }catch(e){
    const code=(e as {code?:string}).code;
    // Never log connection strings, passwords, enrollment material or raw SQL errors.
    if(code==='42501')return response('Veritabanı quraşdırma icazəsi çatmır. Quraşdırma üçün MIGRATION_DATABASE_URL sahibi bağlantısı lazımdır.',503);
    if(code==='23505')return response('Bu istifadəçi adı artıq mövcuddur. Başqa ad seçin.',409);
    if(code==='42P01')return response('Veritabanı cədvəlləri hazır deyil. Quraşdırmanı ilk addımdan başlayın.',503);
    if(code==='42P07')return response('Cədvəllər var, amma migration tarixçəsi uyğun deyil. Mövcud cədvəlləri silməyin; quraşdırma tarixçəsi yoxlanmalıdır.',503);
    return response('Veritabanı quraşdırması tamamlanmadı. Bağlantını və migration icazələrini yoxlayın.',503);
  }finally{db?.release();await admin.end();}
}
