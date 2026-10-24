import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
export async function GET(){try{const s=await identity();const data=await tenantTx(s.tenant_id,async db=>{const l=await db.query('SELECT 1 FROM telegram_links WHERE tenant_id=$1 AND user_id=$2 AND telegram_id IS NOT NULL',[s.tenant_id,s.user_id]);const p=await db.query('SELECT enabled,markets,muted_until FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[s.tenant_id,s.user_id]);return {connected:!!l.rowCount,configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),notificationsEnabled:p.rows[0]?.enabled??false,markets:p.rows[0]?.markets??[],mutedUntil:p.rows[0]?.muted_until??null};});return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Telegram vəziyyətini görmək üçün daxil olun.'},{status:401});}}

