import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {digest,equal} from './security';
import {type MarketInput,summarizeMarket,aiLimits} from './market';
import {resolveAIConfig} from './ai-settings';
export async function claimMarket(db:PoolClient,b:MarketInput,raw:string,summary:ReturnType<typeof summarizeMarket>,limits=aiLimits()):Promise<{id:string|null;reason:string;options?:{order:string[];models:Record<string,string>}}>{
 const a=(await db.query('SELECT a.agent_token_hash,a.broker_login,a.server,a.account_type,u.disabled,t.suspended FROM accounts a JOIN users u ON u.id=a.owner_id JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 FOR UPDATE OF a',[b.accountId])).rows[0];
 if(!a||!a.agent_token_hash||!equal(digest(raw),a.agent_token_hash)||a.broker_login!==b.login||a.server!==b.server||a.account_type!=='DEMO'||a.disabled||a.suspended)throw Error('AUTH');
 const saved=await db.query('INSERT INTO market_latest(tenant_id,account_id,symbol,broker_symbol,quote_at,observed_at,summary) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,symbol) DO UPDATE SET broker_symbol=excluded.broker_symbol,quote_at=excluded.quote_at,observed_at=excluded.observed_at,summary=excluded.summary,received_at=now() WHERE excluded.quote_at>=market_latest.quote_at RETURNING account_id',[b.tenantId,b.accountId,b.symbol,b.brokerSymbol,b.quoteAt,b.observedAt,JSON.stringify(summary)]);
 if(!saved.rowCount)return {id:null,reason:'OLDER_SNAPSHOT'};
 if(summary.dataIssues.length)return {id:null,reason:'DATA_BLOCKED'};
 const config=await resolveAIConfig(db,limits);
 if(!config.preference.enabled)return {id:null,reason:'AI_PAUSED'};
 if(!config.preference.symbols.includes(b.symbol))return {id:null,reason:'SYMBOL_NOT_SELECTED'};
 const last=await db.query("SELECT status,result FROM market_analysis_runs WHERE account_id=$1 AND symbol=$2 AND created_at>now()-($3*interval '1 minute') ORDER BY created_at DESC LIMIT 1",[b.accountId,b.symbol,config.effectiveInterval]);
 // A single format-upgrade retry is allowed only after an old invalid-output failure.
 // It still consumes the daily budget and requires a different closed candle.
 const previous=last.rows[0];const formatRetry=previous?.status==='NO_PROVIDER'&&Number(previous.result?.formatVersion??0)<2&&previous.result?.failures?.some((f:{reason:string})=>f.reason==='INVALID_OUTPUT');
 // One bounded news-context upgrade after an old successful technical-only run.
 // New format-3 results cannot repeat it; same-bar and daily budget still apply.
 const newsUpgrade=previous?.status==='COMPLETED'&&previous.result?.formatVersion===2&&!previous.result?.newsEvidence;
 if(previous&&!formatRetry&&!newsUpgrade)return {id:null,reason:'COOLDOWN'};
 const count=await db.query("SELECT count(*)::int AS n FROM market_analysis_runs WHERE account_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",[b.accountId]);if(count.rows[0].n>=config.service.dailyLimit)return {id:null,reason:'DAILY_AI_LIMIT'};
 const id=randomUUID();const r=await db.query("INSERT INTO market_analysis_runs(id,tenant_id,account_id,symbol,bar_at,status) VALUES($1,$2,$3,$4,$5,'RUNNING') ON CONFLICT(account_id,symbol,bar_at) DO NOTHING RETURNING id",[id,b.tenantId,b.accountId,b.symbol,summary.lastM5]);return {id:r.rowCount?id:null,reason:r.rowCount?'STARTED':'SAME_BAR',options:{order:config.service.order,models:config.service.models}};
}
