import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
export async function GET(){try{const s=await identity();const data=await tenantTx(s.tenant_id,async db=>{
 const link=await db.query('SELECT telegram_id FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL LIMIT 1',[s.user_id]);
 const history=await db.query('SELECT decision,consumed_at FROM approvals WHERE user_id=$1 AND consumed_at IS NOT NULL ORDER BY consumed_at DESC LIMIT 10',[s.user_id]);
 const proposals=await db.query("SELECT p.id,jsonb_build_object('symbol',p.payload->>'symbol') AS payload,p.expires_at,a.label FROM proposals p JOIN accounts a ON a.id=p.account_id WHERE p.expires_at>now() AND NOT EXISTS(SELECT 1 FROM approvals v WHERE v.proposal_id=p.id AND v.user_id=$1 AND v.proposal_version=p.version AND (v.consumed_at IS NOT NULL OR v.expires_at<=now() OR EXISTS(SELECT 1 FROM audit e WHERE e.actor_id=$1 AND e.event='TELEGRAM_PROPOSAL_SENT' AND e.data->>'approvalId'=v.id::text))) ORDER BY p.expires_at LIMIT 10",[s.user_id]);
 const pending=await db.query('SELECT count(*)::int AS count FROM approvals WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()',[s.user_id]);
 return {connected:!!link.rowCount,configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),canConfigure:s.super_admin,pending:pending.rows[0].count,history:history.rows,proposals:s.role==='VIEWER'?[]:proposals.rows};
 });return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Telegram vəziyyətini görmək üçün daxil olun.'},{status:401});}}
