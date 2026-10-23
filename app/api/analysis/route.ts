import {NextResponse} from 'next/server';
import {identity} from '../../../src/server/auth';
import {tenantTx} from '../../../src/server/db';
import {aiLimits} from '../../../src/server/market';
export async function GET(){try{const s=await identity();const rows=await tenantTx(s.tenant_id,db=>db.query('SELECT m.account_id,a.label,m.symbol,m.broker_symbol,m.quote_at,m.received_at,m.summary,r.status AS analysis_status,r.result,r.created_at AS analysis_at,r.completed_at FROM market_latest m JOIN accounts a ON a.id=m.account_id LEFT JOIN LATERAL (SELECT status,result,created_at,completed_at FROM market_analysis_runs WHERE account_id=m.account_id AND symbol=m.symbol ORDER BY created_at DESC LIMIT 1) r ON true ORDER BY a.label,m.symbol'));return NextResponse.json({markets:rows.rows,limits:aiLimits(),executionEnabled:false},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Analizləri görmək üçün daxil olun.'},{status:401});}}
