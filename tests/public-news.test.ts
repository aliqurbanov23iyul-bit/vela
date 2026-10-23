import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {applyMigrations} from '../src/server/migrations';
import {runRestrictedTransaction} from '../src/server/db';
import {feedDefinitions,parseOfficialFeed,fetchOfficialFeed,buildNewsContext,getNewsContext,newsForSymbol} from '../src/server/public-news';
const now=Date.UTC(2026,9,23,12),feed=feedDefinitions[0];
const rss=(host:string=feed.host,date=now-60000)=>`<?xml version="1.0"?><rss><channel><title>Official feed</title><item><title>Policy update</title><link>https://${host}/release/fixture</link><pubDate>${new Date(date).toUTCString()}</pubDate><description><![CDATA[<p>Fixture <b>official</b> statement &amp; context.</p>]]></description></item></channel></rss>`;
test('official RSS accepts dated whitelisted links and produces stable source IDs',()=>{const items=parseOfficialFeed(rss(),feed,now);assert.equal(items.length,1);assert.equal(items[0].publishedAt,new Date(now-60000).toISOString());assert.equal(items[0].summary,'Fixture official statement & context.');assert.match(items[0].id,/^NEWS:FED:/);assert.equal(parseOfficialFeed(rss(),feed,now)[0].id,items[0].id);});
test('RSS rejects HTML, entity expansion, oversized data, external URLs and future or stale headlines',()=>{for(const bad of ['<!DOCTYPE rss [<!ENTITY x "x">]><rss/>','<html><body>Not RSS</body></html>','<rss>',' '.repeat(512001)])assert.throws(()=>parseOfficialFeed(bad,feed,now));assert.equal(parseOfficialFeed(rss('example.com'),feed,now).length,0);assert.equal(parseOfficialFeed(rss(feed.host,now+3600000),feed,now).length,0);assert.equal(parseOfficialFeed(rss(feed.host,now-15*86400000),feed,now).length,0);});
test('fetch never follows redirects or accepts an oversized streamed feed',async()=>{await assert.rejects(fetchOfficialFeed(feed,(async(url,init)=>{assert.equal(url,feed.url);assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).has('authorization'),false);return new Response('',{status:302});}) as typeof fetch,now),/HTTP_302/);await assert.rejects(fetchOfficialFeed(feed,(async()=>new Response('x'.repeat(512001))) as typeof fetch,now),/FEED_TOO_LARGE/);});
test('stale and failed publisher evidence is excluded and XAU uses USD context only',()=>{const rows=feedDefinitions.map(f=>({id:f.id,status:'READY',checked_at:new Date(now),last_success_at:new Date(now),items:parseOfficialFeed(rss(f.host),f,now)}));const good=buildNewsContext(rows,now);assert.equal(good.coverage,'READY');assert.ok(newsForSymbol(good,'EURUSD').items.some(a=>a.currency==='EUR'));assert.ok(newsForSymbol(good,'XAUUSD').items.every(a=>a.currency==='USD'));rows[0].last_success_at=new Date(now-16*60000);rows[1].status='ERROR';const partial=buildNewsContext(rows,now);assert.equal(partial.coverage,'PARTIAL');assert.ok(partial.items.every(a=>a.sourceId!==rows[0].id&&a.sourceId!==rows[1].id));assert.equal(partial.calendarReady,false);});
test('PostgreSQL public feed cache leases, rate limits and failure handling',async()=>{
 const db=new PGlite(),c={query:async(sql:string,values?:unknown[])=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows.length||r?.affectedRows||0};}} as unknown as PoolClient;
 const store={query:(sql:string,values?:unknown[])=>runRestrictedTransaction(c,undefined,d=>d.query(sql,values))};
 try{await applyMigrations(c);let calls=0;const transport=(async(url)=>{calls++;const f=feedDefinitions.find(f=>f.url===url)!;return new Response(rss(f.host,Date.now()-60000));}) as typeof fetch;
  assert.equal((await getNewsContext(store,transport)).coverage,'READY');assert.equal(calls,5);
  assert.equal((await getNewsContext(store,transport)).coverage,'READY');assert.equal(calls,5);
  await db.exec("UPDATE public_news_feeds SET next_check_at=now()-interval '1 minute',lease_token='00000000-0000-4000-8000-000000000001',lease_until=now()+interval '1 minute'");
  await getNewsContext(store,transport);assert.equal(calls,5);
  await db.exec("UPDATE public_news_feeds SET lease_until=now()-interval '1 minute'");
  const failed=await getNewsContext(store,(async()=>new Response('Blocked',{status:403})) as typeof fetch);
  assert.equal(failed.coverage,'UNAVAILABLE');assert.equal(failed.items.length,0);assert.ok(failed.sources.every(s=>s.error==='HTTP_403'&&s.lastSuccessAt));
  await assert.rejects(store.query('DELETE FROM public_news_feeds'),/permission denied/);
 }finally{await db.close();}
});
