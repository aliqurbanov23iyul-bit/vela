import {NextResponse} from 'next/server';
import {identity,requireOwner,sameOrigin} from '../../../src/server/auth';
import {audit,tenantTx} from '../../../src/server/db';
export async function POST(req:Request){try{sameOrigin(req);const s=await identity();requireOwner(s);await tenantTx(s.tenant_id,async db=>{await db.query("UPDATE accounts SET stopped=true,live_enabled=false,permission_version=permission_version+1 WHERE tenant_id=$1",[s.tenant_id]);await db.query("UPDATE orders SET state='BLOCKED' WHERE tenant_id=$1 AND state IN ('CREATED','RESERVED')",[s.tenant_id]);await audit(db,s.tenant_id,s.user_id,'TENANT_NEW_ENTRIES_STOPPED');});return NextResponse.json({ok:true});}catch{return NextResponse.json({error:'Durdurma doğrulanamadı.'},{status:403});}}
