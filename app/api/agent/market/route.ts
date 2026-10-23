import {NextResponse} from 'next/server';
import {claimMarket} from '../../../../src/server/market-store';
import {tenantTx} from '../../../../src/server/db';
import {marketInput,summarizeMarket,aiLimits} from '../../../../src/server/market';
import {analyze} from '../../../../src/server/ai';
export const maxDuration=60;
export async function POST(req:Request){
 try{
  const raw=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!raw||Number(req.headers.get('content-length')??0)>200000)return NextResponse.json({error:'Rejected'},{status:403});
  const body=await req.text();if(body.length>200000)return NextResponse.json({error:'Payload too large'},{status:413});const b=marketInput.parse(JSON.parse(body));const summary=summarizeMarket(b),limits=aiLimits();
  const claim=await tenantTx(b.tenantId,db=>claimMarket(db,b,raw,summary,limits));
  if(!claim.id)return NextResponse.json({ok:true,analysis:claim.reason,dataIssues:summary.dataIssues,executionEnabled:false});
  const id=claim.id;
  try{
   const source=`MT5:${b.symbol}:${summary.lastM5}`;
   const ai=await analyze({analysis_id:id,snapshot_id:id,symbol:b.symbol,source_ids:[source],indicators:{...summary,analysisExpiresAt:new Date(Date.now()+180000).toISOString(),purpose:'Observation only. News/calendar and account risk are not connected. Do not present any output as an executable trade. Explain in Azerbaijani.'}});
   const result={formatVersion:2,bias:ai.action,action:'NO_TRADE',rationale:ai.rationale,provider:ai.provider,model:ai.model,failures:ai.failures,executionBlocks:summary.executionBlocks,source_ids:[source],expiresAt:'expires_at' in ai?ai.expires_at:null};
   await tenantTx(b.tenantId,db=>db.query("UPDATE market_analysis_runs SET status=$1,result=$2,completed_at=now() WHERE id=$3",[ai.provider?'COMPLETED':'NO_PROVIDER',JSON.stringify(result),id]));
   return NextResponse.json({ok:true,analysis:ai.provider?'COMPLETED':'NO_PROVIDER',provider:ai.provider,failures:ai.failures,dataIssues:summary.dataIssues,executionEnabled:false});
  }catch{
   await tenantTx(b.tenantId,db=>db.query("UPDATE market_analysis_runs SET status='FAILED',completed_at=now(),result=$1 WHERE id=$2",[JSON.stringify({action:'NO_TRADE',rationale:'Analiz tamamlanmadı.',executionBlocks:summary.executionBlocks}),id]));return NextResponse.json({ok:true,analysis:'FAILED',executionEnabled:false});
  }
 }catch{return NextResponse.json({error:'Market snapshot rejected'},{status:403});}
}
