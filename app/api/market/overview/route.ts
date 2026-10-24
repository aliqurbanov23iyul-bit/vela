import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {adapters} from '../../../../src/server/news-pipeline';

export const dynamic='force-dynamic';
export async function GET(){
 try{
  const s=await identity();
  const data=await tenantTx(s.tenant_id,async db=>{
   const [sources,state,articles,outlooks,link,prefs]=await Promise.all([
    db.query("SELECT id,name,adapter_key,enabled,status,polling_interval_seconds,last_checked_at,last_success_at,error_code,backoff_seconds,initial_sync_completed FROM news_sources WHERE tenant_id=$1 ORDER BY name",[s.tenant_id]),
    db.query('SELECT last_poll_at,last_success_at,last_error_code FROM news_ingestion_state WHERE tenant_id=$1',[s.tenant_id]),
    db.query("SELECT a.id,a.title,s.name AS source,a.published_at,a.url,a.event_id FROM news_articles a JOIN news_sources s ON s.id=a.source_id WHERE a.tenant_id=$1 ORDER BY a.published_at DESC LIMIT 12",[s.tenant_id]),
    db.query("SELECT o.* FROM market_outlooks o WHERE o.tenant_id=$1 AND o.valid_until>now() ORDER BY o.updated_at DESC LIMIT 12",[s.tenant_id]),
    db.query('SELECT telegram_id FROM telegram_links WHERE tenant_id=$1 AND user_id=$2 AND telegram_id IS NOT NULL LIMIT 1',[s.tenant_id,s.user_id]),
    db.query('SELECT enabled,markets,muted_until,important_news,market_outlooks,daily_digest,hourly_limit,paused FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[s.tenant_id,s.user_id]),
   ]);
   const pref=prefs.rows[0];
   const rows=outlooks.rows;
   let cited:Record<string,unknown[]>={};
   const ids=[...new Set(rows.flatMap(o=>Array.isArray(o.source_article_ids)?o.source_article_ids:[]).filter((id):id is string=>typeof id==='string'))];
   if(ids.length){const q=await db.query("SELECT a.id,a.title,s.name AS source,a.published_at,a.url,a.event_id FROM news_articles a JOIN news_sources s ON s.id=a.source_id WHERE a.tenant_id=$1 AND a.id=ANY($2::uuid[])",[s.tenant_id,ids]);cited=Object.fromEntries(q.rows.map(a=>[a.id,a]));}
   const user=await db.query('SELECT username FROM users WHERE id=$1',[s.user_id]);
   const [jobs,delivery]=await Promise.all([db.query("SELECT count(*) FILTER(WHERE status='QUEUED')::int AS queued,count(*) FILTER(WHERE status='FAILED')::int AS failed,count(*) FILTER(WHERE status='RUNNING')::int AS running FROM news_analysis_jobs WHERE tenant_id=$1",[s.tenant_id]),db.query("SELECT max(sent_at) AS last_sent,count(*) FILTER(WHERE status IN('QUEUED','RETRY','SENDING'))::int AS queued FROM telegram_deliveries WHERE tenant_id=$1 AND user_id=$2",[s.tenant_id,s.user_id])]);
   return {username:user.rows[0]?.username??'',telegram:{configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),connected:!!link.rowCount,notificationsEnabled:!!pref?.enabled,mutedUntil:pref?.muted_until??null,markets:pref?.markets??[],importantNews:pref?.important_news??true,marketOutlooks:pref?.market_outlooks??true,dailyDigest:pref?.daily_digest??false,hourlyLimit:pref?.hourly_limit??4,paused:pref?.paused??false,lastSentAt:delivery.rows[0]?.last_sent??null,queued:delivery.rows[0]?.queued??0},sources:sources.rows.map(source=>({...source,feedUrl:adapters.get(source.adapter_key)?.feedUrl??null,adapterReady:adapters.has(source.adapter_key)})),lastPollAt:state.rows[0]?.last_poll_at??null,lastSuccessAt:state.rows[0]?.last_success_at??null,pollStatus:state.rows[0]?.last_error_code??(sources.rowCount?'WAITING':'SOURCE_NOT_CONFIGURED'),analysis:jobs.rows[0]??{queued:0,failed:0,running:0},aiConfigured:(process.env.AI_PROVIDER_ORDER??'GEMINI,GROQ,OPENROUTER').split(',').some(name=>!!(process.env[name.trim()+'_API_KEY']&&process.env[name.trim()+'_MODEL'])),articles:articles.rows,outlooks:rows.map(o=>({...o,facts:o.facts,risk_factors:o.risk_factors,contrary_evidence:o.contrary_evidence,articles:(o.source_article_ids??[]).map((id:string)=>cited[id]).filter(Boolean)}))};
  });
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Daxil ol və yenidən yoxla.'},{status:401,headers:{'Cache-Control':'no-store'}});}
}


