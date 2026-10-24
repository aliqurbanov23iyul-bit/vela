import {NextResponse} from 'next/server';
import {identity,sameOrigin} from '../../../../src/server/auth';
import {telegram} from '../../../../src/server/telegram';
import {tenantTx,audit} from '../../../../src/server/db';
export async function POST(req:Request){try{
 sameOrigin(req);const s=await identity();if(!s.super_admin)return NextResponse.json({error:'Yalnız admin qura bilər.'},{status:403});
 const origin=new URL(process.env.APP_ORIGIN??'');const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 if(origin.protocol!=='https:'||!secret||!/^[A-Za-z0-9_-]{1,256}$/.test(secret))throw Error('CONFIG');
 await telegram('setWebhook',{url:new URL('/api/telegram/webhook',origin).toString(),secret_token:secret,allowed_updates:['message'],drop_pending_updates:false});
 await tenantTx(s.tenant_id,db=>audit(db,s.tenant_id,s.user_id,'TELEGRAM_WEBHOOK_CONFIGURED'));
 return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Webhook qurulmadı. APP_ORIGIN HTTPS ünvanını, bot tokenını və webhook gizli kodunu yoxlayın.'},{status:400});}}


