'use client';
import {useEffect,useState} from 'react';
import type {NewsContext} from '../../src/server/public-news';
const date=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ'):'—';
const labels={READY:'Hazır',STALE:'Köhnə',ERROR:'Xəta',WAITING:'Gözləyir'};
export default function NewsPanel(){
 const [data,setData]=useState<NewsContext|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 async function read(signal?:AbortSignal){setBusy(true);try{const r=await fetch('/api/news',{cache:'no-store',signal}),d=await r.json();if(!r.ok)throw Error(d.error);if(!signal?.aborted){setData(d);setError('');}}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Xəbərlər oxunmadı.');}finally{if(!signal?.aborted)setBusy(false);}}
 useEffect(()=>{const c=new AbortController();void read(c.signal);const timer=setInterval(()=>{if(document.visibilityState==='visible')void read(c.signal);},60000);return()=>{c.abort();clearInterval(timer);};},[]);
 const coverage=data?.coverage==='READY'?'Mənbələr hazırdır':data?.coverage==='PARTIAL'?'Mənbələr qismən hazırdır':'Mənbələr yoxlanır';
 return <section className="panel detail news-panel"><div className="news-heading"><div><span className="eyebrow">BAZAR GÜNDƏMİ</span><h2>Xəbərlər</h2></div><div className="news-heading-actions"><span className={'connection-state '+(data?.coverage==='READY'?'online':'')}>{data?coverage:'Yoxlanır'}</span><button className="text-button" onClick={()=>void read()} disabled={busy}>{busy?'…':'Yenilə'}</button></div></div>
 {error&&<p className="error" role="alert">{error}</p>}
 {data&&<><div className="news-headlines">{(expanded?data.items:data.items.slice(0,3)).map(item=><article key={item.id}><div><span>{item.source} · {item.currency}</span><time dateTime={item.publishedAt}>{date(item.publishedAt)}</time></div><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a></article>)}{!data.items.length&&<p>Yeni xəbər tapılmadı.</p>}</div>{data.items.length>3&&<button className="text-button news-more" onClick={()=>setExpanded(v=>!v)}>{expanded?'Daha az':`Daha çox · ${data.items.length}`}</button>}
 <details className="news-details"><summary>Mənbə vəziyyəti <span>{data.sources.filter(s=>s.status==='READY').length}/{data.sources.length}</span></summary><div className="news-sources">{data.sources.map(s=><div key={s.id}><strong>{s.name}</strong><span className={'connection-state '+(s.status==='READY'?'online':'')}>{labels[s.status]}</span><small>{s.status==='READY'?`${s.articleCount} başlıq · ${date(s.checkedAt)}`:s.error==='HTTP_403'?'Mənbə giriş vermədi':s.status==='STALE'?'Yeniləmə tələb olunur':s.error??'İlk yoxlama gözlənilir'}</small></div>)}</div><p className="news-scope">Göstərilənlər əlçatan rəsmi mənbələrdən alınan başlıqlardır. Xəbər şərhi və bazar təhlili zəmanətli proqnoz deyil.</p></details></>}
 {!data&&!error&&<p>Xəbərlər yüklənir…</p>}</section>;
}
export type EvidenceResult={newsEvidence?:NewsContext;newsAssessment?:{summary:string;source_ids:string[]}|null;marketEvidence?:{quoteAt:string;m5:string;h1:string}};
export function AnalysisEvidence({result,status,at}:{result:EvidenceResult|null;status:string|null;at:string|null}){
 const news=result?.newsEvidence,assessment=status==='COMPLETED'?result?.newsAssessment:null;
 const cited=news?.items.filter(i=>assessment?.source_ids.includes(i.id))??[];
 const summary=assessment?'Xəbər şərhi var':news?.items.length?`${news.items.length} xəbər kontekstə əlavə edilib`:'Xəbər konteksti yoxdur';
 return <details className="analysis-evidence"><summary><span>Analizin mənbələri</span><small>{summary}</small></summary><div className="evidence-steps"><div><small>Bazar məlumatı</small><strong>{date(result?.marketEvidence?.quoteAt??null)}</strong></div><div><small>AI nəticəsi</small><strong>{date(at)}</strong></div><div><small>Xəbər mənbələri</small><strong>{news?`${news.items.length} başlıq`:'Yoxdur'}</strong></div></div>{assessment&&<><span className="evidence-confirmed">✓ AI xəbər şərhi</span><p>{assessment.summary}</p><div className="evidence-links">{cited.map(i=><a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer">{i.source}<strong>{i.title} ↗</strong></a>)}</div></>}{news&&<small className="evidence-coverage">Mənbələrin əhatəsi: {news.coverage==='READY'?'tam':news.coverage==='PARTIAL'?'qismən':'məhdud'} · Son yoxlama: {date(news.checkedAt)}</small>}<small className="evidence-coverage">AI şərhi məlumat xülasəsidir; ticarət qərarı deyil.</small></details>;
}
