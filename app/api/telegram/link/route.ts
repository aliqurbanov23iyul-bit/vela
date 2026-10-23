import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {identity,sameOrigin} from '../../../../src/server/auth';
import {tenantTx,audit} from '../../../../src/server/db';
import {digest} from '../../../../src/server/security';
import {compact,pairingCode} from '../../../../src/server/telegram';
export async function POST(req:Request){try{sameOrigin(req);const s=await identity();if(s.role==='VIEWER')throw Error('FORBIDDEN');const code=pairingCode();await tenantTx(s.tenant_id,async db=>{await db.query('DELETE FROM telegram_links WHERE user_id=$1 AND telegram_id IS NULL',[s.user_id]);await db.query("INSERT INTO telegram_links(id,tenant_id,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",[randomUUID(),s.tenant_id,s.user_id,digest(code)]);await audit(db,s.tenant_id,s.user_id,'TELEGRAM_PAIRING_CREATED');});return NextResponse.json({command:`/start ${compact(s.tenant_id)}.${code}`,expiresInSeconds:300},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Eşleştirme kodu üretilemedi.'},{status:403});}}
