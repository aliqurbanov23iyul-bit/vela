import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';

export const dynamic='force-dynamic';
export async function GET(){
 try{
  const s=await identity();
  const data=await tenantTx(s.tenant_id,async db=>{
   const [sources,state,articles,outlooks,link,prefs]=await Promise.all([
    db.query("SELECT id,name,enabled,status,polling_interval_seconds,last_checked_at,last_success_at,error_code FROM news_sources WHERE tenant_id=$1 ORDER BY name",[s.tenant_id]),
    db.query('SELECT last_poll_at,last_success_at,last_error_code FROM news_ingestion_state WHERE tenant_id=$1',[s.tenant_id]),
    db.query("SELECT a.id,a.title,s.name AS source,a.published_at,a.url,a.event_id FROM news_articles a JOIN news_sources s ON s.id=a.source_id WHERE a.tenant_id=$1 ORDER BY a.published_at DESC LIMIT 12",[s.tenant_id]),
    db.query("SELECT o.* FROM market_outlooks o WHERE o.tenant_id=$1 AND o.valid_until>now() ORDER BY o.updated_at DESC LIMIT 12",[s.tenant_id]),
    db.query('SELECT telegram_id FROM telegram_links WHERE tenant_id=$1 AND user_id=$2 AND telegram_id IS NOT NULL LIMIT 1',[s.tenant_id,s.user_id]),
    db.query('SELECT enabled,markets,muted_until FROM telegram_preferences WHERE tenant_id=$1 AND user_id=$2',[s.tenant_id,s.user_id]),
   ]);
   const pref=prefs.rows[0];
   const rows=outlooks.rows;
   let cited:Record<string,unknown[]>={};
   const ids=[...new Set(rows.flatMap(o=>Array.isArray(o.source_article_ids)?o.source_article_ids:[]).filter((id):id is string=>typeof id==='string'))];
   if(ids.length){const q=await db.query("SELECT a.id,a.title,s.name AS source,a.published_at,a.url,a.event_id FROM news_articles a JOIN news_sources s ON s.id=a.source_id WHERE a.tenant_id=$1 AND a.id=ANY($2::uuid[])",[s.tenant_id,ids]);cited=Object.fromEntries(q.rows.map(a=>[a.id,a]));}
   const user=await db.query('SELECT username FROM users WHERE id=$1',[s.user_id]);
   return {username:user.rows[0]?.username??'',telegram:{configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),connected:!!link.rowCount,notificationsEnabled:!!pref?.enabled,mutedUntil:pref?.muted_until??null,markets:pref?.markets??[]},sources:sources.rows,lastPollAt:state.rows[0]?.last_poll_at??null,lastSuccessAt:state.rows[0]?.last_success_at??null,pollStatus:state.rows[0]?.last_error_code??(sources.rowCount?'WAITING':'SOURCE_NOT_CONFIGURED'),articles:articles.rows,outlooks:rows.map(o=>({...o,facts:o.facts,risk_factors:o.risk_factors,contrary_evidence:o.contrary_evidence,articles:(o.source_article_ids??[]).map((id:string)=>cited[id]).filter(Boolean)}))};
  });
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Daxil ol və yenidən yoxla.'},{status:401,headers:{'Cache-Control':'no-store'}});}
}


