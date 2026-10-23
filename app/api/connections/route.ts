import {NextResponse} from 'next/server';
import {identity} from '../../../src/server/auth';
import {tenantTx} from '../../../src/server/db';
import {resolveAIConfig} from '../../../src/server/ai-settings';
export async function GET(){try{const s=await identity();const data=await tenantTx(s.tenant_id,async db=>{
 const accounts=await db.query("SELECT a.id,a.label,a.broker_login,a.server,a.account_type,a.heartbeat,(SELECT (m.summary->>'brokerTimeOffsetMinutes')::int FROM market_latest m WHERE m.account_id=a.id ORDER BY m.received_at DESC LIMIT 1) AS broker_offset FROM accounts a ORDER BY a.label");
 const link=await db.query('SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL LIMIT 1',[s.user_id]);
 const analyses=await db.query("SELECT DISTINCT ON(account_id,symbol) account_id,symbol,status,completed_at,result->>'provider' AS provider FROM market_analysis_runs ORDER BY account_id,symbol,created_at DESC");
 const ai=await resolveAIConfig(db);
 return {accounts:accounts.rows,telegramConnected:!!link.rowCount,telegramConfigured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),analyses:analyses.rows,aiEnabled:ai.preference.enabled,aiReady:ai.ready,aiSymbols:ai.preference.symbols,canManage:s.role==='OWNER',canConfigure:s.super_admin};
 });return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Bağlantılarınızı görmək üçün hesabınıza daxil olun.'},{status:401});}}
