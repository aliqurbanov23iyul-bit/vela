import {createHash,randomUUID} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {pool} from './db';

export const feedDefinitions=[
 {id:'FED',name:'FED · Pul siyasəti',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',host:'www.federalreserve.gov',currency:'USD'},
 {id:'FED_SPEECHES',name:'FED · Çıxışlar',url:'https://www.federalreserve.gov/feeds/speeches.xml',host:'www.federalreserve.gov',currency:'USD'},
 {id:'ECB',name:'ECB · Açıqlamalar',url:'https://www.ecb.europa.eu/rss/press.html',host:'www.ecb.europa.eu',currency:'EUR'},
 {id:'BLS_CPI',name:'BLS · İnflyasiya (CPI)',url:'https://www.bls.gov/feed/cpi.rss',host:'www.bls.gov',currency:'USD'},
 {id:'BLS_JOBS',name:'BLS · Məşğulluq',url:'https://www.bls.gov/feed/empsit.rss',host:'www.bls.gov',currency:'USD'},
] as const;
type Feed=typeof feedDefinitions[number];
export type NewsArticle={id:string;sourceId:string;source:string;currency:string;title:string;summary:string;url:string;publishedAt:string};
export type FeedState={id:string;name:string;url:string;status:'READY'|'STALE'|'ERROR'|'WAITING';checkedAt:string|null;lastSuccessAt:string|null;error:string|null;articleCount:number};
export type NewsContext={checkedAt:string;coverage:'READY'|'PARTIAL'|'UNAVAILABLE';sources:FeedState[];items:NewsArticle[];calendarReady:false};
type DB={query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[];rowCount?:number|null}>};
const maxBytes=512000,lookback=14*86400000;
function plain(value:unknown,max:number){const s=typeof value==='string'?value:typeof value==='number'?String(value):'';return s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim().slice(0,max);}
export function parseOfficialFeed(xml:string,feed:Feed,now=Date.now()):NewsArticle[]{
 if(Buffer.byteLength(xml)>maxBytes||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('INVALID_FEED');
 const parsed=new XMLParser({ignoreAttributes:true,processEntities:false,parseTagValue:false,isArray:tag=>tag==='item'}).parse(xml);
 const channel=parsed?.rss?.channel;if(!channel||typeof channel!=='object')throw Error('INVALID_FEED');
 const rows=Array.isArray(channel.item)?channel.item:[],items:NewsArticle[]=[],seen=new Set<string>();
 for(const row of rows.slice(0,100)){
  const title=plain(row.title,300),summary=plain(row.description,600),date=Date.parse(row.pubDate??row['dc:date']??'');let link:URL;
  try{link=new URL(String(row.link));}catch{continue;}
  if(link.protocol!=='https:'||link.hostname!==feed.host||link.username||link.password||!title||!Number.isFinite(date)||date>now+300000||now-date>lookback)continue;
  link.hash='';const id='NEWS:'+feed.id+':'+createHash('sha256').update(link.href).digest('hex').slice(0,20);if(seen.has(id))continue;seen.add(id);
  items.push({id,sourceId:feed.id,source:feed.name,currency:feed.currency,title,summary,url:link.href,publishedAt:new Date(date).toISOString()});
 }
 return items.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,12);
}
export async function fetchOfficialFeed(feed:Feed,transport:typeof fetch=fetch,now=Date.now()){
 const response=await transport(feed.url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/rss+xml, application/xml, text/xml','User-Agent':'VELA-News/1.0 (public official RSS observation)'}});
 if(!response.ok)throw Error('HTTP_'+response.status);
 if(Number(response.headers.get('content-length')??0)>maxBytes)throw Error('FEED_TOO_LARGE');
 if(!response.body)throw Error('EMPTY_FEED');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw Error('FEED_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return parseOfficialFeed(Buffer.concat(chunks).toString('utf8'),feed,now);
}
const iso=(value:unknown)=>value?new Date(value as string|Date).toISOString():null;
export function buildNewsContext(rows:Record<string,unknown>[],now=Date.now()):NewsContext{
 const items:NewsArticle[]=[];const sources=feedDefinitions.map(feed=>{const row=rows.find(r=>r.id===feed.id);const lastSuccessAt=iso(row?.last_success_at),checkedAt=iso(row?.checked_at);
  const current=!!lastSuccessAt&&now-Date.parse(lastSuccessAt)<15*60000;
  const status:FeedState['status']=row?.status==='ERROR'?'ERROR':row?.status==='READY'?(current?'READY':'STALE'):'WAITING';
  const stored=Array.isArray(row?.items)?row.items as NewsArticle[]:[];
  const valid=stored.filter(a=>a.sourceId===feed.id&&typeof a.publishedAt==='string'&&Date.parse(a.publishedAt)<=now+300000&&now-Date.parse(a.publishedAt)<=lookback);
  // Stale or failed sources may be displayed as unavailable but never sent as current evidence.
  if(status==='READY')items.push(...valid);
  return {id:feed.id,name:feed.name,url:feed.url,status,checkedAt,lastSuccessAt,error:typeof row?.error_code==='string'?row.error_code:null,articleCount:status==='READY'?valid.length:0};
 });
 const ready=sources.filter(s=>s.status==='READY').length;
 return {checkedAt:new Date(now).toISOString(),coverage:ready===sources.length?'READY':ready?'PARTIAL':'UNAVAILABLE',sources,items:items.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)),calendarReady:false};
}
export async function getNewsContext(db:DB=pool,transport:typeof fetch=fetch):Promise<NewsContext>{
 const lease=randomUUID();
 const claimed=await db.query("UPDATE public_news_feeds SET lease_token=$1,lease_until=now()+interval '30 seconds',next_check_at=now()+interval '5 minutes' WHERE next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING id",[lease]);
 const tasks=await Promise.allSettled(claimed.rows.map(async row=>{const feed=feedDefinitions.find(f=>f.id===row.id);if(!feed)return;
  try{const items=await fetchOfficialFeed(feed,transport);await db.query("UPDATE public_news_feeds SET status='READY',checked_at=now(),last_success_at=now(),error_code=NULL,items=$1,lease_until=NULL,lease_token=NULL WHERE id=$2 AND lease_token=$3",[JSON.stringify(items),feed.id,lease]);}
  catch(error){const message=error instanceof Error?error.message:'';const code=/^(HTTP_\d{3}|INVALID_FEED|FEED_TOO_LARGE|EMPTY_FEED)$/.test(message)?message:'FETCH_FAILED';await db.query("UPDATE public_news_feeds SET status='ERROR',checked_at=now(),error_code=$1,lease_until=NULL,lease_token=NULL WHERE id=$2 AND lease_token=$3",[code,feed.id,lease]);}
 }));
 if(tasks.some(t=>t.status==='rejected'))throw Error('NEWS_STORAGE_FAILED');
 return buildNewsContext((await db.query('SELECT * FROM public_news_feeds ORDER BY id')).rows);
}
export function newsForSymbol(context:NewsContext,symbol:string):NewsContext{
 const filtered=context.items.filter(item=>symbol==='XAUUSD'?item.currency==='USD':item.currency==='USD'||item.currency==='EUR');
 // Preserve both currencies even when one publisher produces many headlines.
 const selected=feedDefinitions.flatMap(feed=>filtered.filter(i=>i.sourceId===feed.id).slice(0,2)).slice(0,6);
 return {...context,items:selected};
}
export function unavailableNews():NewsContext{return {checkedAt:new Date().toISOString(),coverage:'UNAVAILABLE',sources:feedDefinitions.map(f=>({id:f.id,name:f.name,url:f.url,status:'ERROR',checkedAt:null,lastSuccessAt:null,error:'STORAGE_UNAVAILABLE',articleCount:0})),items:[],calendarReady:false};}
