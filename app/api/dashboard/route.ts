import {NextResponse} from 'next/server';
import {identity} from '../../../src/server/auth';
import {tenantTx} from '../../../src/server/db';
export async function GET(){try{const s=await identity();const data=await tenantTx(s.tenant_id,async db=>{const accounts=await db.query('SELECT id,label,mode,live_enabled,stopped,currency,account_type,snapshot,heartbeat,reconciled_at FROM accounts ORDER BY label');const audit=await db.query('SELECT event,created_at FROM audit ORDER BY created_at DESC LIMIT 20');return {accounts:accounts.rows,audit:audit.rows,role:s.role};});return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Oturum veya veri bağlantısı gerekli.'},{status:401});}}
