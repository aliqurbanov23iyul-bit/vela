import {NextResponse} from 'next/server';
import {claimMarket} from '../../../../src/server/market-store';
import {tenantTx} from '../../../../src/server/db';
import {marketInput,summarizeMarket,aiLimits} from '../../../../src/server/market';
import {analyze} from '../../../../src/server/ai';
import {getNewsContext,newsForSymbol,unavailableNews} from '../../../../src/server/public-news';
export const maxDuration=60;
export async function POST(req:Request){
 try{
  const raw=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!raw||Number(req.headers.get('content-length')??0)>200000)return NextResponse.json({error:'Rejected'},{status:403});
  const body=await req.text();if(body.length>200000)return NextResponse.json({error:'Payload too large'},{status:413});const b=marketInput.parse(JSON.parse(body));const summary=summarizeMarket(b),limits=aiLimits();
  const claim=await tenantTx(b.tenantId,db=>claimMarket(db,b,raw,summary,limits));
  if(!claim.id){
   // An authenticated running connector also keeps the shared public news cache
   // current when AI is paused, cooling down, or the market itself is closed.
   let coverage='UNAVAILABLE';try{coverage=(await getNewsContext()).coverage;}catch{}
   const latest=await tenantTx(b.tenantId,async db=>(await db.query('SELECT status,completed_at,result FROM market_analysis_runs WHERE account_id=$1 AND symbol=$2 ORDER BY created_at DESC LIMIT 1',[b.accountId,b.symbol])).rows[0]);
   return NextResponse.json({ok:true,analysis:claim.reason,dataIssues:summary.dataIssues,newsCoverage:coverage,latestAnalysis:latest?{status:latest.status,completedAt:latest.completed_at,newsAssessed:latest.status==='COMPLETED'&&!!latest.result?.newsAssessment,newsSent:latest.result?.newsEvidence?.items?.length??0,newsSources:[...new Set((latest.result?.newsEvidence?.items??[]).map((i:{sourceId:string})=>i.sourceId))]}:null,executionEnabled:false});
  }
  const id=claim.id;
  try{
   const source=`MT5:${b.symbol}:${summary.lastM5}`;
   let context;try{context=await getNewsContext();}catch{context=unavailableNews();}const news=newsForSymbol(context,b.symbol),sourceIds=[source,...news.items.map(i=>i.id)];
   const ai=await analyze({analysis_id:id,snapshot_id:id,symbol:b.symbol,source_ids:sourceIds,news,indicators:{...summary,analysisExpiresAt:new Date(Date.now()+180000).toISOString(),purpose:'Observation only. Supplied official RSS news is partial context, never a complete news/calendar clearance. Account risk and execution remain blocked. Explain in Azerbaijani.'}},fetch,claim.options);
   const assessment=ai.provider&&'news_assessment' in ai?ai.news_assessment??null:null;
   const result={formatVersion:3,bias:ai.action,action:'NO_TRADE',rationale:ai.rationale,provider:ai.provider,model:ai.model,failures:ai.failures,executionBlocks:summary.executionBlocks,source_ids:ai.provider?ai.source_ids:[],inputSourceIds:sourceIds,newsEvidence:news,newsAssessment:assessment,marketEvidence:{quoteAt:b.quoteAt,m5:summary.lastM5,h1:summary.lastH1},expiresAt:'expires_at' in ai?ai.expires_at:null};
   await tenantTx(b.tenantId,db=>db.query("UPDATE market_analysis_runs SET status=$1,result=$2,completed_at=now() WHERE id=$3",[ai.provider?'COMPLETED':'NO_PROVIDER',JSON.stringify(result),id]));
   return NextResponse.json({ok:true,analysis:ai.provider?'COMPLETED':'NO_PROVIDER',provider:ai.provider,failures:ai.failures,dataIssues:summary.dataIssues,newsCoverage:news.coverage,newsSent:news.items.length,newsAssessed:!!assessment,executionEnabled:false});
  }catch{
   await tenantTx(b.tenantId,db=>db.query("UPDATE market_analysis_runs SET status='FAILED',completed_at=now(),result=$1 WHERE id=$2",[JSON.stringify({action:'NO_TRADE',rationale:'Analiz tamamlanmadı.',executionBlocks:summary.executionBlocks}),id]));return NextResponse.json({ok:true,analysis:'FAILED',executionEnabled:false});
  }
 }catch{return NextResponse.json({error:'Market snapshot rejected'},{status:403});}
}
