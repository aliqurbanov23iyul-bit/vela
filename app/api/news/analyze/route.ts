import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {sameOrigin} from '../../../../src/server/security';
import {getNewsContext} from '../../../../src/server/public-news';
import {summarizeNews} from '../../../../src/server/news-summary';

export const dynamic='force-dynamic';

export async function POST(req:Request){
 try{
  sameOrigin(req);
  const session=await identity();
  const context=await getNewsContext();
  if(!context.items.length)return NextResponse.json({error:'Əvvəlcə xəbər başlıqlarının yüklənməsini gözlə.'},{status:409});
  const providers=(process.env.AI_PROVIDER_ORDER??'GEMINI,GROQ,OPENROUTER').split(',').map(value=>value.trim()).filter(Boolean).slice(0,3);
  if(!providers.some(provider=>process.env[provider+'_API_KEY']&&process.env[provider+'_MODEL']))return NextResponse.json({error:'AI provayderi qurulmayıb.'},{status:503});
  const limit=Math.min(100,Math.max(1,Number(process.env.AI_MAX_ANALYSES_PER_DAY??24)));
  const usage=await tenantTx(session.tenant_id,db=>db.query('INSERT INTO ai_daily_usage(tenant_id,usage_date,analyses) VALUES($1,$2,1) ON CONFLICT(tenant_id,usage_date) DO UPDATE SET analyses=ai_daily_usage.analyses+1 WHERE ai_daily_usage.analyses<$3 RETURNING analyses',[session.tenant_id,new Date().toISOString().slice(0,10),limit]));
  if(!usage.rowCount)return NextResponse.json({error:'Bugünkü AI təhlil limiti bitib.'},{status:429});
  const result=await summarizeNews(context.items);
  const sourceIds=new Set(result.source_ids);
  const sources=context.items.filter(item=>sourceIds.has(item.id)).map(({id,title,source,url,publishedAt})=>({id,title,source,url,publishedAt}));
  return NextResponse.json({...result,sources,coverage:context.coverage,checkedAt:context.checkedAt},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const status=code==='ORIGIN'?403:code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='NO_NEWS'?409:code==='NO_AI_PROVIDER'?503:code==='AI_RATE_LIMIT'?429:503;
  const message=code==='ORIGIN'?'Sorğu saytın özündən olmalıdır.':code==='UNAUTHORIZED'||code==='FORBIDDEN'?'Daxil ol və yenidən yoxla.':code==='AI_RATE_LIMIT'?'AI provayderinin limitinə çatılıb.':'AI xülasəsi alınmadı. Bir az sonra yenidən yoxla.';
  return NextResponse.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
 }
}
