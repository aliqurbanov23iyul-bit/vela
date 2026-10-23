import {NextResponse} from 'next/server';
import {z} from 'zod';
import {identity,requireOwner,sameOrigin} from '../../../../../src/server/auth';
import {tenantTx,audit} from '../../../../../src/server/db';
import {digest,token} from '../../../../../src/server/security';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{
 sameOrigin(req);const s=await identity();requireOwner(s);const id=z.string().uuid().parse((await params).id);
 const b=z.object({login:z.string().regex(/^\d{1,20}$/),server:z.string().trim().min(1).max(100),terminalPath:z.string().min(1).max(500)}).strict().parse(await req.json());
 const origin=new URL(process.env.APP_ORIGIN??'');if(origin.protocol!=='https:')throw Error('HTTPS');const raw=token();
 await tenantTx(s.tenant_id,async db=>{const r=await db.query('UPDATE accounts SET agent_token_hash=$1,broker_login=$2,server=$3 WHERE id=$4 AND owner_id=$5',[digest(raw),b.login,b.server,id,s.user_id]);if(r.rowCount!==1)throw Error('FORBIDDEN');await audit(db,s.tenant_id,s.user_id,'AGENT_TOKEN_ROTATED',id);});
 return new NextResponse(JSON.stringify({APP_ORIGIN:origin.origin,MT5_ACCOUNT_ID:id,MT5_TENANT_ID:s.tenant_id,MT5_LOGIN:b.login,MT5_SERVER:b.server,MT5_TERMINAL_PATH:b.terminalPath,MT5_AGENT_TOKEN:raw},null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="vela-connection.json"','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Bağlantı faylı yaradılmadı. Hesab sahibi olaraq daxil olun və məlumatları yoxlayın.'},{status:403});}}
