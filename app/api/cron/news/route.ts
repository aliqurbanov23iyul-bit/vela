import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {pool,tenantTx} from '../../../../src/server/db';
import {adapters,ingestBatch,processNewsAnalysisQueue} from '../../../../src/server/news-pipeline';
function valid(req:Request){const expected=process.env.CRON_SECRET;if(!expected)return false;const got=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';const a=Buffer.from(expected),b=Buffer.from(got);return a.length===b.length&&timingSafeEqual(a,b);}
export async function GET(req:Request){return run(req);}
export async function POST(req:Request){return run(req);}
async function run(req:Request){
 if(!valid(req))return NextResponse.json({error:'Forbidden'},{status:403});
 try{
  const targets=await pool.query('SELECT * FROM public.claim_news_poll_targets(20)');
  let checked=0,success=0,articles=0,notModified=0,failed=0;const tenants=new Set<string>(),sourceResults=[];
  for(const t of targets.rows){
   checked++;tenants.add(t.tenant_id);const adapter=adapters.get(t.adapter_key);
   if(!adapter){failed++;sourceResults.push({source:t.adapter_key,status:'ADAPTER_MISSING'});continue;}
   try{
    const batch=await adapter.fetchNew({cursor:t.cursor,etag:t.etag,lastModified:t.last_modified,signal:AbortSignal.timeout(18000)});
    const backfill=!t.initial_sync_completed;
    await tenantTx(t.tenant_id,async db=>{
     const result=batch.notModified?{inserted:0}:await ingestBatch(db,t.tenant_id,t as {id:string;adapter_key:string},batch.items,{backfill});
     await db.query("UPDATE news_sources SET cursor=$3,etag=$4,last_modified=$5,status='READY',error_code=NULL,last_checked_at=now(),last_success_at=now(),lease_until=NULL,backoff_seconds=0,initial_sync_completed=true,updated_at=now() WHERE tenant_id=$1 AND id=$2",[t.tenant_id,t.id,batch.cursor,batch.etag??t.etag,batch.lastModified??t.last_modified]);
     await db.query('INSERT INTO news_ingestion_state(tenant_id,last_poll_at,last_success_at,last_error_code) VALUES($1,now(),now(),NULL) ON CONFLICT(tenant_id) DO UPDATE SET last_poll_at=now(),last_success_at=now(),last_error_code=NULL,updated_at=now()',[t.tenant_id]);
     articles+=result.inserted;
    });
    success++;if(batch.notModified)notModified++;sourceResults.push({source:t.adapter_key,status:batch.notModified?'UNCHANGED':'OK',received:batch.items.length,initialBackfill:backfill});
   }catch(error){
    failed++;const code=error instanceof Error?error.message.slice(0,80):'FETCH_FAILED';
    await tenantTx(t.tenant_id,async db=>{
     await db.query("UPDATE news_sources SET status='ERROR',error_code=$3,last_checked_at=now(),lease_until=NULL,backoff_seconds=LEAST(GREATEST(CASE WHEN backoff_seconds=0 THEN polling_interval_seconds ELSE backoff_seconds*2 END,polling_interval_seconds),3600),updated_at=now() WHERE tenant_id=$1 AND id=$2",[t.tenant_id,t.id,code]);
     await db.query('INSERT INTO news_ingestion_state(tenant_id,last_poll_at,last_error_code) VALUES($1,now(),$2) ON CONFLICT(tenant_id) DO UPDATE SET last_poll_at=now(),last_error_code=$2,updated_at=now()',[t.tenant_id,code]);
    });sourceResults.push({source:t.adapter_key,status:'ERROR',code});
   }
  }
  let analyzed=0,skipped=0;for(const tenant of tenants){const result=await processNewsAnalysisQueue(tenant);analyzed+=result.completed;skipped+=result.skipped;}
  return NextResponse.json({checked,success,failed,notModified,articles,analyzed,skipped,configuredAdapters:adapters.size,status:failed?'PARTIAL':'READY',sources:sourceResults});
 }catch{return NextResponse.json({error:'News pipeline unavailable'},{status:503});}
}

